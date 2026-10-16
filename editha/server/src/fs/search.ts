import path from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import { EdithaError } from '../errors.js';
import { isTempName } from './atomic.js';
import { decodeText } from './files.js';
import { READ_ONLY_DIRS } from './paths.js';

/** SR-1: ricerca in tutti i file. */
export interface SearchOptions {
  query: string;
  regex?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

export interface SearchMatch {
  /** Riga e colonna da 1, lunghezza in caratteri. */
  line: number;
  column: number;
  length: number;
  /** Parte della riga che contiene la corrispondenza (accorciata se la riga è lunga). */
  text: string;
  /** Posizione (da 0) di `text` nella riga: la corrispondenza è a `column - 1 - offset`. */
  offset: number;
}

export interface SearchResult {
  results: { path: string; matches: SearchMatch[] }[];
  files: number;
  matches: number;
  /** La ricerca si è fermata prima (troppi risultati o troppo tempo). */
  truncated: boolean;
}

const MAX_MATCHES = 2000;
const MAX_MATCHES_PER_FILE = 200;
const MAX_LINE = 400;
/** Oltre questa lunghezza una riga non viene esaminata tutta (file minificati, dati). */
const MAX_SCAN = 10_000;
export const SEARCH_BUDGET_MS = 8000;
/** File che non vale la pena leggere: database, archivi, immagini. */
const SKIP_EXT = /\.(db|db-shm|db-wal|sqlite|sqlite3|zip|gz|tar|tgz|png|jpe?g|gif|webp|ico|bmp|mp3|mp4|wav|pdf|woff2?|ttf|so|pyc)$/i;

/**
 * SEC-7: secrets.yaml e le sue copie (secrets_copia.yaml.bak, secrets.old.yaml…) non entrano mai
 * nella ricerca né nella sostituzione.
 */
export function isSecretsFile(name: string): boolean {
  return /^secrets.*\.ya?ml(\.bak)?$/i.test(name);
}

/** Espressione regolare per la ricerca; un errore di sintassi diventa invalid_request. */
export function searchPattern(opts: SearchOptions): RegExp {
  let source = opts.regex ? opts.query : opts.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (opts.wholeWord) source = `(?<![\\w])(?:${source})(?![\\w])`;
  try {
    return new RegExp(source, opts.caseSensitive ? 'g' : 'gi');
  } catch (err) {
    throw new EdithaError('invalid_request', `Espressione regolare non valida: ${(err as Error).message}`);
  }
}

/** Messaggi dal worker di ricerca: un file con risultati, oppure la fine. */
export type SearchMessage =
  | { type: 'file'; path: string; matches: SearchMatch[] }
  | { type: 'done'; files: number; truncated: boolean };

/**
 * Percorre /config e cerca nei file di testo; ogni file con risultati viene passato
 * subito a `onFile`, così chi aspetta ha i risultati anche se la ricerca va interrotta.
 */
export async function searchTree(
  root: string,
  opts: SearchOptions,
  maxFileSize: number,
  onFile: (path: string, matches: SearchMatch[]) => void,
): Promise<{ files: number; truncated: boolean }> {
  const pattern = searchPattern(opts);
  let files = 0;
  let total = 0;
  let truncated = false;
  const walk = async (abs: string, rel: string): Promise<void> => {
    let dirents;
    try {
      dirents = await readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    dirents.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
    for (const d of dirents) {
      if (truncated) return;
      if (d.isSymbolicLink() || isTempName(d.name)) continue;
      const childAbs = path.join(abs, d.name);
      const childRel = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        // Cartelle di sistema (SEC-8): solo al primo livello, come nel resto di Editha.
        if (!(rel === '' && READ_ONLY_DIRS.includes(d.name))) await walk(childAbs, childRel);
        continue;
      }
      // secrets.yaml e copie (SEC-7): password e chiavi non devono comparire nei risultati.
      if (!d.isFile() || SKIP_EXT.test(d.name) || isSecretsFile(d.name)) continue;
      let data: Buffer;
      try {
        if ((await stat(childAbs)).size > maxFileSize) continue;
        data = await readFile(childAbs);
      } catch {
        continue;
      }
      const text = decodeText(data);
      if (text === null) continue;
      files++;
      const matches: SearchMatch[] = [];
      const lines = text.split('\n');
      for (let i = 0; i < lines.length && matches.length < MAX_MATCHES_PER_FILE; i++) {
        const full = lines[i]!.replace(/\r$/, '');
        const line = full.length > MAX_SCAN ? full.slice(0, MAX_SCAN) : full;
        pattern.lastIndex = 0;
        for (let m = pattern.exec(line); m; m = pattern.exec(line)) {
          if (m[0].length === 0) {
            pattern.lastIndex++;
            continue;
          }
          // Nelle righe lunghe si manda la parte attorno alla corrispondenza, non solo l'inizio.
          const offset = m.index + m[0].length <= MAX_LINE ? 0 : Math.max(0, m.index - 80);
          matches.push({
            line: i + 1,
            column: m.index + 1,
            length: m[0].length,
            text: full.slice(offset, offset + MAX_LINE),
            offset,
          });
          if (matches.length >= MAX_MATCHES_PER_FILE) break;
        }
      }
      if (matches.length) {
        onFile(childRel, matches);
        total += matches.length;
        if (total >= MAX_MATCHES) truncated = true;
      }
    }
  };
  await walk(root, '');
  return { files, truncated };
}

/** SR-3: sostituzione in un testo, riga per riga come la ricerca (le corrispondenze sono le stesse). */
export function replaceInText(
  text: string,
  opts: SearchOptions,
  replacement: string,
  maxLength = Infinity,
): { content: string; count: number } | null {
  const pattern = searchPattern(opts);
  let count = 0;
  let length = 0;
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    const cr = line.endsWith('\r');
    const body = cr ? line.slice(0, -1) : line;
    const replaced = body.replace(pattern, (...args: unknown[]) => {
      const match = args[0] as string;
      if (match.length === 0) return match;
      count++;
      return opts.regex ? expandReplacement(replacement, args) : replacement;
    });
    lines.push(cr ? replaced + '\r' : replaced);
    // Un risultato oltre il limite dei file non si costruisce nemmeno (memoria del server).
    length += replaced.length + 1;
    if (length > maxLength) return null;
  }
  return { content: lines.join('\n'), count };
}

/**
 * Con le espressioni regolari valgono $1…$99, $<nome>, $&, $`, $' e $$ come in JavaScript.
 * Il testo si costruisce dai dati della corrispondenza trovata nella riga intera: rieseguire
 * l'espressione sul solo pezzo trovato sbaglierebbe con lookahead, lookbehind e \b.
 */
export function expandReplacement(template: string, args: unknown[]): string {
  const last = args[args.length - 1];
  const named = typeof last === 'object' && last !== null ? (last as Record<string, string | undefined>) : null;
  const tail = named ? 3 : 2;
  const groups = args.slice(1, args.length - tail) as (string | undefined)[];
  const offset = args[args.length - tail] as number;
  const whole = args[args.length - tail + 1] as string;
  const match = args[0] as string;
  return template.replace(/\$(\$|&|`|'|\d{1,2}|<([^>]*)>)/g, (token: string, what: string, name?: string) => {
    if (what === '$') return '$';
    if (what === '&') return match;
    if (what === '`') return whole.slice(0, offset);
    if (what === "'") return whole.slice(offset + match.length);
    if (name !== undefined) return named ? (named[name] ?? '') : token;
    const two = Number(what);
    if (two >= 1 && two <= groups.length) return groups[two - 1] ?? '';
    const one = Number(what[0]);
    if (what.length === 2 && one >= 1 && one <= groups.length) return (groups[one - 1] ?? '') + what[1];
    return token;
  });
}

export type ReplaceMessage =
  | { type: 'file'; rel: string; content: string; count: number; etag: string }
  | { type: 'skip'; rel: string; reason: 'too_large' }
  | { type: 'done' };
