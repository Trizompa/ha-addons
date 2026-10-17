import { isCollection, parseAllDocuments, visit, type ScalarTag, type CollectionTag, type YAMLError } from 'yaml';
import { t, type MessageKey } from '../i18n/index.js';

export interface YamlProblem {
  from: number;
  to: number;
  severity: 'error' | 'warning';
  message: string;
}

/**
 * Tag specifici di Home Assistant: accettati come validi, senza risolverli
 * (il contenuto dei file inclusi non è affare del validatore di sintassi).
 */
const HA_SCALAR_TAGS = [
  '!include',
  '!include_dir_list',
  '!include_dir_named',
  '!include_dir_merge_list',
  '!include_dir_merge_named',
  '!secret',
  '!env_var',
  '!input',
];

/** Tag di ESPHome (cartella esphome/): accettati senza avvisi, anche su mappe ed elenchi. */
const ESPHOME_TAGS = new Set([
  ...HA_SCALAR_TAGS,
  '!lambda',
  '!extend',
  '!remove',
  '!force',
]);

/** Oltre questa lunghezza (circa 1 MB) il file non si controlla: il controllo bloccherebbe l'editor. */
export const LINT_MAX_CHARS = 1_000_000;

/** File di ESPHome: stanno nella cartella esphome/ di /config. */
export function isEsphomePath(path: string): boolean {
  return /(?:^|\/)esphome\//.test(path);
}

/** Distanza di modifica tra due parole (tag scritti male: !secrets → !secret). */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_v, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length]!;
}

/** Tag di HA più simile a quello scritto, se la differenza è piccola. */
function closestTag(tag: string): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const known of HA_SCALAR_TAGS) {
    const d = editDistance(tag.toLowerCase(), known);
    if (d < bestDistance) [best, bestDistance] = [known, d];
  }
  return bestDistance <= Math.max(1, Math.min(3, Math.floor(tag.length / 3))) ? best : null;
}

const customTags: (ScalarTag | CollectionTag)[] = HA_SCALAR_TAGS.map(
  (tag): ScalarTag => ({
    tag,
    identify: () => false,
    resolve: (value: string) => value,
  }),
);

const TRANSLATED = new Set([
  'DUPLICATE_KEY',
  'BAD_INDENT',
  'TAB_AS_INDENT',
  'MISSING_CHAR',
  'MULTILINE_IMPLICIT_KEY',
  'BLOCK_AS_IMPLICIT_KEY',
  'UNEXPECTED_TOKEN',
  'BAD_SCALAR_START',
  'TAG_RESOLVE_FAILED',
  'BAD_DQ_ESCAPE',
  'BLOCK_IN_FLOW',
  'MULTIPLE_ANCHORS',
  'ALIAS_PROPS',
  'BAD_ALIAS',
]);

/** Errori di struttura per cui conviene guardare l'indentazione della riga. */
const STRUCTURAL = new Set([
  'BAD_INDENT',
  'MISSING_CHAR',
  'MULTILINE_IMPLICIT_KEY',
  'BLOCK_AS_IMPLICIT_KEY',
  'UNEXPECTED_TOKEN',
  'BAD_SCALAR_START',
]);

/** Testo diviso in righe, con l'offset d'inizio di ciascuna. */
class Lines {
  readonly starts: number[] = [0];
  readonly text: string[];
  /** Righe interne a valori su più righe (blocchi | e >, testi lunghi, [ ] e { }): il rientro lì è libero. */
  readonly free = new Set<number>();

  constructor(source: string) {
    this.text = source.split('\n');
    for (let i = 0, pos = 0; i < this.text.length - 1; i++) {
      pos += this.text[i]!.length + 1;
      this.starts.push(pos);
    }
  }

  /** Indice (da 0) della riga che contiene l'offset. */
  indexAt(offset: number): number {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
}

const indentOf = (line: string) => /^ */.exec(line)![0].length;
/** Riga che conta per la struttura: non vuota e non solo commento. */
const isContent = (line: string) => line.trim() !== '' && !line.trimStart().startsWith('#');
/** `chiave:valore` senza spazio (esclusi URL, orari, icone mdi: come valori). */
const MISSING_COLON_VALUE = /^ *(?:- +)?([A-Za-z_][\w-]*) +([^\s:#\-][^:#]*)$/;
const MISSING_SPACE = /^(\s*)(- )?([A-Za-z_][\w-]*):([^\s:/][^\n]*)$/;

/**
 * La riga apre un blocco: finisce con «:», con «-», con l'intestazione di un testo su più
 * righe (| > anche con indicatori, es. |-, >+, |2), oppure con «chiave:» seguita solo da
 * ancora e/o tag (es. «base: &base», «x: !!map»).
 */
function opensBlock(text: string): boolean {
  return /(:|-|\|[-+]?\d?[-+]?|>[-+]?\d?[-+]?)$/.test(text) || /:\s+(?:[&!]\S*\s*)+$/.test(text);
}

/** Nome della chiave che inizia in `pos` (la libreria indica solo il primo carattere), senza virgolette. */
function keyAt(text: string, pos: number): string {
  const m = /^(?:"((?:[^"\\\n]|\\.)*)"|'((?:[^'\n]|'')*)'|([^:,{}[\]\n]+?))\s*:/.exec(text.slice(pos));
  if (!m) return '';
  return (m[1] ?? m[2]?.replace(/''/g, "'") ?? m[3] ?? '').trim();
}

/** Riga precedente con contenuto, saltando vuote e commenti. */
function previousContent(lines: Lines, index: number): number {
  for (let i = index - 1; i >= 0; i--) if (isContent(lines.text[i]!)) return i;
  return -1;
}

/** Livelli di rientro "aperti" sopra una riga: quelli a cui può allinearsi. */
function openLevels(lines: Lines, index: number): number[] {
  const levels: number[] = [];
  let limit = Infinity;
  for (let i = index - 1; i >= 0 && limit > 0; i--) {
    const line = lines.text[i]!;
    // Il testo di un blocco | o > non è struttura: il suo rientro non è un livello.
    if (!isContent(line) || lines.free.has(i)) continue;
    const n = indentOf(line);
    if (n < limit) {
      levels.push(n);
      // Anche il contenuto dopo "- " è un livello valido.
      const dash = /^ *- +/.exec(line);
      if (dash && dash[0].length < limit) levels.push(dash[0].length);
      limit = n;
    }
  }
  return [...new Set(levels)].sort((a, b) => a - b);
}

/** Spiegazione di un errore; `lined` se il testo cita le righe coinvolte. */
interface Explained {
  message: string;
  lined: boolean;
}

/** Spiegazione concreta di un errore di struttura, guardando la riga e quelle sopra. */
function explainStructure(lines: Lines, index: number): Explained | null {
  const line = lines.text[index]!;
  if (line === undefined) return null;
  const missing = MISSING_SPACE.exec(line);
  // In un elenco «- mdi:home» è un testo voluto: vale solo per le chiavi tipiche di HA.
  if (missing && (!missing[2] || HA_KEYS.has(missing[3]!))) {
    return { message: t('yaml.explain.missingSpace', { key: missing[3]!, value: missing[4]!.trim() }), lined: false };
  }
  const message = explainIndent(lines, index);
  return message ? { message, lined: true } : null;
}

function explainIndent(lines: Lines, index: number): string | null {
  const line = lines.text[index]!;
  const n = index + 1;
  // Dentro [ ] e { } su più righe (JSON incollato) le tabulazioni vanno bene.
  if (/^ *\t/.test(line) && !lines.free.has(index)) return t('yaml.explain.tab', { line: n });
  const prev = previousContent(lines, index);
  if (prev === -1 || !isContent(line)) return null;
  const here = indentOf(line);
  const prevLine = lines.text[prev]!;
  const above = indentOf(prevLine);
  const prevText = prevLine.replace(/\s+#.*$/, '').trimEnd();
  // «below 30» tra altre chiavi: quasi sempre manca «:» tra chiave e valore.
  const inline = MISSING_COLON_VALUE.exec(line.replace(/\s+#.*$/, ''));
  if (inline && here <= above + 2 && /:(\s+[^|>\s].*)?$/.test(prevText)) {
    return t('yaml.explain.missingColonValue', { line: n, key: inline[1]!, value: inline[2]!.trim() });
  }
  const dash = /^ *- +/.exec(prevLine);
  if (here > above) {
    // Sotto un elemento di lista ("- chiave: valore") si allinea al testo dopo il trattino.
    if (dash && !opensBlock(prevText)) {
      const item = dash[0].length;
      if (here === item) return null;
      const key = /^ *- +([^:\s]+)/.exec(prevLine)?.[1] ?? '';
      return t('yaml.explain.listItem', { line: n, spaces: here, prev: prev + 1, item, key });
    }
    if (!opensBlock(prevText)) {
      // Il caso più comune: una chiave scritta senza i due punti.
      const bare = /^\s*(?:- +)?([^\s:#"'{}\[\],]+)$/.exec(prevText);
      if (bare) return t('yaml.explain.missingColon', { prev: prev + 1, key: bare[1]!, line: n });
      // La riga sopra ha già un valore: non può contenere altre righe.
      const valued = /^\s*(?:- +)?([^:#]+?):\s+(\S.*)$/.exec(prevText);
      if (valued) {
        return t('yaml.explain.hasValue', { prev: prev + 1, key: valued[1]!.trim(), value: valued[2]!, line: n });
      }
      return t('yaml.explain.deeper', { line: n, prev: prev + 1 });
    }
    return null;
  }
  if (here < above) {
    const levels = openLevels(lines, index);
    if (!levels.includes(here)) {
      return t('yaml.explain.noLevel', { line: n, spaces: here, levels: levels.join(', ') });
    }
  }
  return null;
}

/**
 * Blocchi "rotti": una riga che non apre un blocco (parola senza «:», oppure «chiave: valore»)
 * seguita da righe più rientrate. Mappa ogni riga coinvolta all'indice della riga colpevole.
 */
function brokenBlocks(lines: Lines): Map<number, number> {
  const blocks = new Map<number, number>();
  for (let i = 0; i < lines.text.length; i++) {
    const line = lines.text[i]!;
    if (!isContent(line) || /^ *- /.test(line)) continue;
    const text = line.replace(/\s+#.*$/, '').trimEnd();
    const opensNothing = /^\s*[^\s:#"'{}\[\],]+$/.test(text) || /^\s*[^:#]+?:\s+\S/.test(text);
    if (!opensNothing || opensBlock(text)) continue;
    const base = indentOf(line);
    let j = i + 1;
    while (j < lines.text.length && (!isContent(lines.text[j]!) || indentOf(lines.text[j]!) > base)) j++;
    // Righe più rientrate subito sotto: solo allora il blocco è rotto.
    const next = previousContent(lines, j) ;
    if (next <= i) continue;
    for (let k = i; k < j; k++) blocks.set(k, i);
  }
  return blocks;
}

/** Errori tipici di chi inizia, spiegati con la correzione (riga già nota). */
function explainCommon(err: YAMLError, lines: Lines, text: string, index: number): string | null {
  const line = lines.text[index] ?? '';
  const n = index + 1;
  if (err.code === 'UNEXPECTED_TOKEN') {
    // 'L'allarme è attivo': il testo tra apici finisce al secondo apice.
    const quote = /(?:^\s*|:\s+|-\s+)'(?:[^']|'')*'(?=[^\s#,\]}])/.exec(line);
    if (quote) {
      const open = quote.index + quote[0].indexOf("'");
      const close = line.replace(/\s+#[^']*$/, '').lastIndexOf("'");
      const inner = line.slice(open + 1, close > open ? close : undefined).replace(/''/g, "'");
      return t('yaml.explain.apostrophe', {
        line: n,
        doubled: `'${inner.replace(/'/g, "''")}'`,
        double: `"${inner.replace(/"/g, '\\"')}"`,
      });
    }
  }
  if (err.code === 'BLOCK_AS_IMPLICIT_KEY') {
    // «message: Attenzione: porta aperta»: il secondo «: » apre un'altra chiave.
    const colon = /^\s*(?:-\s+)?([^\s:#'"{}[\],][^:#]*?):\s+([^\s'"{[|>&*!#%@`][^#]*?:(?:\s.*)?)$/.exec(line.replace(/\s+#.*$/, ''));
    if (colon) {
      const value = colon[2]!.trim();
      const quoted = value.includes('"') ? `'${value.replace(/'/g, "''")}'` : `"${value}"`;
      return t('yaml.explain.colonInValue', { line: n, key: colon[1]!.trim(), quoted });
    }
  }
  if (err.code === 'BAD_SCALAR_START' && /(?:^\s*|:\s+|-\s+)\{%/.test(line)) {
    return t('yaml.explain.jinjaBlock', { line: n });
  }
  return null;
}

function translate(err: YAMLError, lines: Lines, text: string, path: string): Explained & { severity?: 'error' } {
  const index = lines.indexAt(Math.min(err.pos[0], Math.max(0, text.length - 1)));
  if (err.code === 'DUPLICATE_KEY') {
    // La libreria indica la chiave ripetuta: il nome si prende da lì, non dalla riga.
    const key = keyAt(text, err.pos[0]) || /^\s*(?:- )?([^:#]+?)\s*:/.exec(lines.text[index] ?? '')?.[1];
    if (key) return { message: t('yaml.explain.duplicate', { key }), lined: false };
  }
  if (err.code === 'TAB_AS_INDENT') return { message: t('yaml.explain.tab', { line: index + 1 }), lined: true };
  if (err.code === 'BAD_DQ_ESCAPE') {
    const seq = /^\\(?:u[0-9a-fA-F]{0,4}|x[0-9a-fA-F]{0,2}|.)?/.exec(text.slice(err.pos[0]))?.[0] || '\\';
    return { message: t('yaml.explain.badEscape', { seq }), lined: false };
  }
  if (err.code === 'TAG_RESOLVE_FAILED') {
    const tag = /tag: (\S+)/.exec(err.message)?.[1] ?? text.slice(err.pos[0], err.pos[1]).trim();
    // Un tag che HA non conosce: il file non si carica. I tag noti su una mappa restano un avviso.
    // In esphome/ i tag li controlla ESPHome: resta un avviso.
    if (!HA_SCALAR_TAGS.includes(tag)) {
      const hint = closestTag(tag);
      return {
        message: hint ? t('yaml.explain.unknownTagHint', { tag, hint }) : t('yaml.explain.unknownTag', { tag }),
        lined: false,
        ...(isEsphomePath(path) ? {} : { severity: 'error' as const }),
      };
    }
  }
  const common = explainCommon(err, lines, text, index);
  if (common) return { message: common, lined: true };
  if (STRUCTURAL.has(err.code)) {
    // L'errore può cadere sulla riga prima o dopo quella sbagliata: si guardano tutte e tre.
    const explained =
      explainStructure(lines, index) ??
      (index + 1 < lines.text.length ? explainStructure(lines, index + 1) : null) ??
      (index > 0 ? explainStructure(lines, index - 1) : null);
    if (explained) return explained;
  }
  const base = TRANSLATED.has(err.code) ? t(`yaml.${err.code}` as MessageKey) : null;
  // Il messaggio originale (in inglese) resta utile come dettaglio.
  const detail = err.message.split('\n')[0] ?? '';
  return { message: base ? `${base}: ${detail}` : detail, lined: false };
}

/** Spazi "invisibili" diversi dallo spazio normale: tabulazione, spazio non separabile e simili. */
const SPACE_LIKE = /[ \t\u00a0\u2000-\u200a\u3000\ufeff]/;
/** «chiave:» all'inizio del resto della riga, seguita da uno spazio di qualunque tipo. */
const KEY_COLON = /^(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\n]|'')*'|[^\s#'"{}[\],:\u00a0\u2000-\u200a\u3000\ufeff](?:[^#:\n]|:(?![ \t\u00a0\u2000-\u200a\u3000\ufeff]|$))*?)[ \t]*:(?=[ \t\u00a0\u2000-\u200a\u3000\ufeff]|$)/;

/** Fine (indice di riga) di un valore tra [ ], { } o virgolette che inizia in `pos`; -1 se non si chiude. */
function valueEnd(text: string[], first: number, pos: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let li = first; li < text.length; li++) {
    const s = text[li]!;
    for (let p = li === first ? pos : 0; p < s.length; p++) {
      const ch = s[p]!;
      if (quote) {
        if (quote === '"' && ch === '\\') p++;
        else if (ch === quote && quote === "'" && s[p + 1] === "'") p++;
        else if (ch === quote) {
          quote = null;
          if (depth === 0) return li;
        }
        continue;
      }
      // Un apice dentro una parola («it's») non apre un testo.
      if ((ch === '"' || ch === "'") && (p === pos && li === first || /[\s,[{:]/.test(s[p - 1] ?? ' '))) quote = ch;
      else if (ch === '#' && (p === 0 || /\s/.test(s[p - 1]!))) break;
      else if (ch === '{' || ch === '[') depth++;
      else if ((ch === '}' || ch === ']') && --depth <= 0) return li;
    }
  }
  return -1;
}

/**
 * Righe che continuano un valore iniziato sopra: [ ] e { } su più righe (JSON incollato) e testi
 * tra virgolette. Lì Home Assistant accetta qualunque rientro, tabulazioni comprese; la libreria
 * qui no, quindi servono anche quando il file non si legge. I blocchi | e > si saltano.
 */
function continuationLines(lines: Lines): Set<number> {
  const out = new Set<number>();
  const text = lines.text;
  for (let i = 0; i < text.length; ) {
    const line = text[i]!;
    if (!isContent(line)) {
      i++;
      continue;
    }
    let pos = /^[ \t]*/.exec(line)![0].length;
    for (let m; (m = /^[-?](?:[ \t]+|$)/.exec(line.slice(pos))); ) pos += m[0].length;
    const key = KEY_COLON.exec(line.slice(pos));
    if (key) pos += key[0].length + /^[ \t]*/.exec(line.slice(pos + key[0].length))![0].length;
    const c = line[pos];
    if (c === '|' || c === '>') {
      const indent = indentOf(line);
      let j = i + 1;
      while (j < text.length && (text[j]!.trim() === '' || indentOf(text[j]!) > indent)) j++;
      i = j;
      continue;
    }
    if (c === '{' || c === '[' || c === '"' || c === "'") {
      const end = valueEnd(text, i, pos);
      for (let k = i + 1; k <= end; k++) out.add(k);
      i = Math.max(end, i) + 1;
      continue;
    }
    i++;
  }
  return out;
}

const codePoint = (c: string) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');

/**
 * Tabulazioni e spazi speciali (U+00A0 incollato da una pagina web, …) nel rientro o subito
 * dopo «- », «? », «: »: Home Assistant (libyaml) rifiuta il file, mentre la libreria qui
 * a volte li legge come testo. Anche righe vuote e commenti, fuori dai valori su più righe.
 */
function whitespaceProblems(lines: Lines): YamlProblem[] {
  const out: YamlProblem[] = [];
  lines.text.forEach((text, index) => {
    if (lines.free.has(index)) return;
    const start = lines.starts[index]!;
    let pos = index === 0 && text.startsWith('\ufeff') ? 1 : 0;
    let found: { at: number; end: number; leading: boolean } | null = null;
    const run = (leading: boolean) => {
      const from = pos;
      while (pos < text.length && SPACE_LIKE.test(text[pos]!)) pos++;
      if (found) return;
      for (let i = from; i < pos; i++) {
        if (text[i] !== ' ') {
          let end = i;
          while (end < pos && text[end] !== ' ') end++;
          found = { at: i, end, leading };
          return;
        }
      }
    };
    run(true);
    // Indicatori di elenco e di chiave complessa, anche in fila («- - x», «- ? x»).
    while ((text[pos] === '-' || text[pos] === '?') && (pos + 1 === text.length || SPACE_LIKE.test(text[pos + 1]!))) {
      pos++;
      run(false);
    }
    const key = KEY_COLON.exec(text.slice(pos));
    if (key) {
      pos += key[0].length;
      run(false);
    }
    const f = found as { at: number; end: number; leading: boolean } | null;
    if (!f) return;
    const c = text[f.at]!;
    const n = index + 1;
    out.push({
      from: start + f.at,
      to: start + f.end,
      severity: 'error',
      message:
        c === '\t'
          ? f.leading
            ? t('yaml.explain.tab', { line: n })
            : t('yaml.explain.tabAfter', { line: n })
          : t('yaml.explain.invisibleSpace', { line: n, code: codePoint(c) }),
    });
  });
  return out;
}

/**
 * La libreria a volte indica un punto vuoto (fine riga, fine file): si sposta la
 * segnalazione sul testo più vicino, così la sottolineatura si vede.
 */
export function visibleRange(text: string, start: number, end: number): [number, number] {
  const len = text.length;
  let from = Math.max(0, Math.min(start, len));
  let to = Math.max(from, Math.min(end, len));
  if (text.slice(from, to).trim() !== '') return [from, to];
  let f = from;
  while (f < len && /\s/.test(text[f]!)) f++;
  if (f < len) {
    const lineEnd = text.indexOf('\n', f);
    return [f, lineEnd === -1 ? len : lineEnd];
  }
  // Solo spazi fino alla fine: si segna l'ultima riga con del testo.
  let b = Math.min(from, len) - 1;
  while (b >= 0 && /\s/.test(text[b]!)) b--;
  if (b < 0) return [0, Math.min(1, len)];
  const lineStart = text.lastIndexOf('\n', b) + 1;
  from = lineStart + (text.slice(lineStart, b + 1).length - text.slice(lineStart, b + 1).trimStart().length);
  to = b + 1;
  return [from, to];
}

/** HA tollera alcune situazioni che la libreria considera errori. */
function severityOf(err: YAMLError): 'error' | 'warning' {
  if (err.name === 'YAMLWarning') return 'warning';
  if (err.code === 'DUPLICATE_KEY') return 'warning';
  return 'error';
}

/** Chiavi di Home Assistant per cui «- chiave:valore» è quasi certamente uno spazio dimenticato. */
const HA_KEYS = new Set([
  'platform', 'service', 'action', 'entity_id', 'device_id', 'area_id', 'trigger', 'condition',
  'alias', 'name', 'state', 'to', 'from', 'at', 'event', 'event_type', 'domain', 'type',
  'value_template', 'target', 'data', 'mode', 'unique_id', 'icon', 'friendly_name', 'id',
  'default', 'logs', 'host', 'port', 'username', 'password', 'url', 'message', 'title',
  'unit_of_measurement', 'device_class', 'state_class', 'scan_interval', 'above', 'below', 'for',
  'brightness', 'brightness_pct', 'latitude', 'longitude', 'elevation', 'time_zone', 'unit_system',
  'country', 'currency', 'language', 'initial', 'min', 'max', 'step', 'options',
]);

const MAX_PROBLEMS = 200;

/** Valori che Home Assistant (YAML 1.1) legge come vero/falso se non sono tra virgolette. */
const YAML11_BOOLEANS = new Set(['on', 'off', 'yes', 'no']);

/** Testo `chiave:valore` (manca lo spazio) all'inizio di una riga di un valore semplice. */
const KEY_NO_SPACE = /^([A-Za-z_][\w-]*):([^\s:/].*)$/;

/**
 * Validazione YAML (HA-1) con spiegazioni concrete degli errori di indentazione e avvisi
 * per gli errori tipici di Home Assistant che restano YAML valido. Le posizioni coincidono
 * con quelle dell'editor (offset nel testo), così la sottolineatura cade nel punto giusto (FEP #5).
 * `path` (relativo a /config) decide quali tag sono validi: in esphome/ anche quelli di ESPHome.
 */
export function lintYaml(text: string, path = ''): YamlProblem[] {
  // File enormi (dati, log incollati): niente controllo, l'editor resta reattivo.
  if (text.length > LINT_MAX_CHARS) return [];
  const problems: YamlProblem[] = [];
  const lines = new Lines(text);
  // Dentro [ ] e { } su più righe e nei testi tra virgolette le tabulazioni a inizio riga vanno
  // bene per HA: la libreria le legge come spazi (stessa lunghezza, posizioni invariate).
  const continued = continuationLines(lines);
  const parsed = continued.size
    ? lines.text.map((l, i) => (continued.has(i) ? l.replace(/^[ \t]+/, (w) => w.replace(/\t/g, ' ')) : l)).join('\n')
    : text;
  const docs = parseAllDocuments(parsed, { customTags, prettyErrors: false, strict: false });
  const list = Array.isArray(docs) ? docs : [docs];
  const freeLines = lines.free;
  for (const i of continued) freeLines.add(i);
  const warnings: YamlProblem[] = [];
  const esphome = isEsphomePath(path);

  const markFlow = (node: { flow?: boolean; range?: [number, number, number] | null }) => {
    if (!node.flow || !node.range) return;
    const first = lines.indexAt(node.range[0]);
    const last = lines.indexAt(Math.max(node.range[0], node.range[1] - 1));
    for (let i = first + 1; i <= last; i++) freeLines.add(i);
  };
  // Prima la struttura (righe libere, avvisi), poi gli errori: le spiegazioni ne hanno bisogno.
  for (const doc of list) {
    visit(doc, {
      // «value_template: {{ … }}» senza virgolette è YAML valido (una mappa usata come chiave),
      // ma Home Assistant lo rifiuta: va scritto tra virgolette.
      Pair: (_key, pair) => {
        const k = pair.key;
        if (!isCollection(k) || !k.range) return;
        // «{{ x }}» si legge come { {x} }: la chiave interna è preceduta da un'altra «{».
        const template = text[k.range[0] - 1] === '{' && text[k.range[0]] === '{';
        problems.push({
          from: template ? k.range[0] - 1 : k.range[0],
          to: template ? Math.min(text.length, k.range[1] + 1) : k.range[1],
          severity: 'error',
          message: template ? t('yaml.explain.template') : t('yaml.explain.complexKey'),
        });
        return visit.SKIP;
      },
      // «*nome» senza un'ancora «&nome» definita prima: Home Assistant non carica il file.
      Alias: (_key, node) => {
        if (node.resolve(doc) || !node.range) return;
        problems.push({
          from: node.range[0],
          to: node.range[1],
          severity: 'error',
          message: t('yaml.explain.alias', { name: node.source }),
        });
      },
      // Collezioni [ ] e { } su più righe: le righe interne possono rientrare come si vuole.
      Map: (_key, node) => markFlow(node),
      Seq: (_key, node) => markFlow(node),
      Scalar: (key, node) => {
        const range = node.range;
        if (!range) return;
        const first = lines.indexAt(range[0]);
        const last = lines.indexAt(Math.max(range[0], range[1] - 1));
        for (let i = first + 1; i <= last; i++) freeLines.add(i);
        // Valori con tag (!secret on, !input yes): sono nomi, non vero/falso.
        if (node.type !== 'PLAIN' || key === 'key' || node.tag) return;
        const source = text.slice(range[0], range[1]);
        if (YAML11_BOOLEANS.has(source.toLowerCase())) {
          warnings.push({
            from: range[0],
            to: range[1],
            severity: 'warning',
            message: t('yaml.explain.boolean', { value: source }),
          });
        }
        // «- platform:template», o «default:info» da solo sulla riga sotto «logger:», è un testo,
        // non una chiave: manca lo spazio dopo i due punti. Si guarda ogni riga del valore, ma solo
        // se il testo sta all'inizio della riga (non «name: mdi:home») e solo per chiavi tipiche
        // di HA: «- mdi:home» in un elenco di icone è un testo voluto.
        let at = range[0];
        for (const segment of source.split('\n')) {
          const segStart = at;
          at += segment.length + 1;
          const lineStart = lines.starts[lines.indexAt(segStart)]!;
          if (!/^\s*(?:-\s+)*$/.test(text.slice(lineStart, segStart))) continue;
          const trimmed = segment.trim();
          const missing = KEY_NO_SPACE.exec(trimmed);
          if (!missing || !HA_KEYS.has(missing[1]!)) continue;
          const from = segStart + segment.length - segment.trimStart().length;
          warnings.push({
            from,
            to: from + trimmed.length,
            severity: 'warning',
            message: t('yaml.explain.missingSpace', { key: missing[1]!, value: missing[2]! }),
          });
        }
      },
    });
  }

  // Tabulazioni e spazi speciali: la spiegazione chiara sostituisce gli errori della libreria sulla riga.
  const spaces = whitespaceProblems(lines);
  const spaceLines = new Set(spaces.map((p) => lines.indexAt(p.from)));
  problems.push(...spaces);

  // Le spiegazioni citano la riga: la libreria che dice lo stesso non aggiunge niente.
  const seen = new Set<string>(spaces.map((p) => p.message));
  const blocks = brokenBlocks(lines);
  const reported = new Set<number>();
  /** Righe già spiegate da un errore tipico: gli altri errori della libreria lì sono solo conseguenze. */
  const explainedLines = new Set<number>();
  for (const doc of list) {
    for (const err of [...doc.errors, ...doc.warnings]) {
      // Un file pieno di errori (es. incollato male): bastano i primi, e il controllo resta veloce.
      if (problems.length >= MAX_PROBLEMS) break;
      // Più «<<: *ancora» nello stesso blocco: Home Assistant le unisce tutte, va bene.
      if (err.code === 'DUPLICATE_KEY' && keyAt(text, err.pos[0]) === '<<') continue;
      const errLine = lines.indexAt(err.pos[0]);
      if (spaceLines.has(errLine) || explainedLines.has(errLine)) continue;
      // JSON incollato dentro [ ] e { }: HA non guarda il rientro, la libreria sì.
      if ((err.code === 'TAB_AS_INDENT' || err.code === 'BAD_INDENT') && continued.has(errLine)) continue;
      if (err.code === 'TAB_AS_INDENT' && freeLines.has(errLine)) continue;
      if (err.code === 'TAG_RESOLVE_FAILED' && esphome) {
        const tag = /tag: (\S+)/.exec(err.message)?.[1] ?? '';
        if (ESPHOME_TAGS.has(tag)) continue;
      }
      const [from, to] = visibleRange(text, err.pos[0], err.pos[1]);
      // Dopo una chiave senza «:» la libreria segnala anche le righe sotto, che sono giuste:
      // per tutto il blocco basta la prima spiegazione.
      const block = blocks.get(errLine);
      if (block !== undefined && severityOf(err) === 'error') {
        if (reported.has(block)) continue;
        reported.add(block);
      }
      const explained = translate(err, lines, text, path);
      const message = explained.message;
      if (explainCommon(err, lines, text, errLine)) explainedLines.add(errLine);
      // Più errori della libreria per lo stesso sbaglio: una sola spiegazione. Le spiegazioni
      // che citano le righe coinvolte bastano da sole; gli altri messaggi (chiave ripetuta,
      // carattere riservato…) contano una volta per riga, perché lo stesso errore in due punti
      // sono due errori.
      const key = explained.lined ? message : `${message}@${lines.indexAt(from)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      problems.push({ from, to, severity: explained.severity ?? severityOf(err), message });
    }
  }

  // Rientro dispari in un file che va di 2 in 2: spesso un blocco finito al livello sbagliato.
  const indents: { index: number; spaces: number }[] = [];
  lines.text.forEach((line, index) => {
    if (isContent(line) && !freeLines.has(index) && indentOf(line) > 0) indents.push({ index, spaces: indentOf(line) });
  });
  const even = indents.filter((i) => i.spaces % 2 === 0).length;
  if (indents.length >= 4 && even / indents.length >= 0.8) {
    for (const { index, spaces } of indents) {
      if (spaces % 2 === 0) continue;
      if (warnings.length >= MAX_PROBLEMS) break;
      const from = lines.starts[index]! + spaces;
      warnings.push({
        from,
        to: lines.starts[index]! + lines.text[index]!.length,
        severity: 'warning',
        message: t('yaml.explain.oddIndent', { spaces }),
      });
    }
  }

  // Un avviso sulla stessa riga di un errore aggiungerebbe solo confusione.
  const errorLines = new Set(problems.map((p) => lines.indexAt(p.from)));
  for (const w of warnings) if (!errorLines.has(lines.indexAt(w.from))) problems.push(w);
  // Il limite vale per tutto: prima gli errori, poi gli avvisi, in ordine di posizione.
  problems.sort((a, b) => a.from - b.from);
  if (problems.length <= MAX_PROBLEMS) return problems;
  const kept = new Set([...problems.filter((p) => p.severity === 'error'), ...problems.filter((p) => p.severity !== 'error')].slice(0, MAX_PROBLEMS));
  return problems.filter((p) => kept.has(p));
}
