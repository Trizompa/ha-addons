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
    if (!isContent(line)) continue;
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

/** Spiegazione concreta di un errore di struttura, guardando la riga e quelle sopra. */
function explainStructure(lines: Lines, index: number): string | null {
  const line = lines.text[index]!;
  const n = index + 1;
  if (/^ *\t/.test(line)) return t('yaml.explain.tab', { line: n });
  const missing = MISSING_SPACE.exec(line);
  // In un elenco «- mdi:home» è un testo voluto: vale solo per le chiavi tipiche di HA.
  if (missing && (!missing[2] || HA_KEYS.has(missing[3]!))) return t('yaml.explain.missingSpace', { key: missing[3]!, value: missing[4]!.trim() });
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

function translate(err: YAMLError, lines: Lines, text: string): string {
  const index = lines.indexAt(Math.min(err.pos[0], Math.max(0, text.length - 1)));
  if (err.code === 'DUPLICATE_KEY') {
    // La libreria indica la chiave ripetuta: il nome si prende da lì, non dalla riga.
    const key = keyAt(text, err.pos[0]) || /^\s*(?:- )?([^:#]+?)\s*:/.exec(lines.text[index] ?? '')?.[1];
    if (key) return t('yaml.explain.duplicate', { key });
  }
  if (err.code === 'TAB_AS_INDENT') return t('yaml.explain.tab', { line: index + 1 });
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
  return base ? `${base}: ${detail}` : detail;
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
]);

const MAX_PROBLEMS = 200;

/** Valori che Home Assistant (YAML 1.1) legge come vero/falso se non sono tra virgolette. */
const YAML11_BOOLEANS = new Set(['on', 'off', 'yes', 'no']);

/**
 * Validazione YAML (HA-1) con spiegazioni concrete degli errori di indentazione e avvisi
 * per gli errori tipici di Home Assistant che restano YAML valido. Le posizioni coincidono
 * con quelle dell'editor (offset nel testo), così la sottolineatura cade nel punto giusto (FEP #5).
 */
export function lintYaml(text: string): YamlProblem[] {
  const problems: YamlProblem[] = [];
  const lines = new Lines(text);
  const docs = parseAllDocuments(text, { customTags, prettyErrors: false, strict: false });
  const list = Array.isArray(docs) ? docs : [docs];
  /** Righe interne a valori su più righe (blocchi | e >, testi lunghi): il rientro lì è libero. */
  const freeLines = new Set<number>();
  const warnings: YamlProblem[] = [];

  const markFlow = (node: { flow?: boolean; range?: [number, number, number] | null }) => {
    if (!node.flow || !node.range) return;
    const first = lines.indexAt(node.range[0]);
    const last = lines.indexAt(Math.max(node.range[0], node.range[1] - 1));
    for (let i = first + 1; i <= last; i++) freeLines.add(i);
  };
  const seen = new Set<string>();
  const blocks = brokenBlocks(lines);
  const reported = new Set<number>();
  for (const doc of list) {
    for (const err of [...doc.errors, ...doc.warnings]) {
      // Un file pieno di errori (es. incollato male): bastano i primi, e il controllo resta veloce.
      if (problems.length >= MAX_PROBLEMS) break;
      // Più «<<: *ancora» nello stesso blocco: Home Assistant le unisce tutte, va bene.
      if (err.code === 'DUPLICATE_KEY' && keyAt(text, err.pos[0]) === '<<') continue;
      const [from, to] = visibleRange(text, err.pos[0], err.pos[1]);
      // Dopo una chiave senza «:» la libreria segnala anche le righe sotto, che sono giuste:
      // per tutto il blocco basta la prima spiegazione.
      const block = blocks.get(lines.indexAt(err.pos[0]));
      if (block !== undefined && severityOf(err) === 'error') {
        if (reported.has(block)) continue;
        reported.add(block);
      }
      const message = translate(err, lines, text);
      // Più errori della libreria per lo stesso sbaglio: una sola spiegazione. Le spiegazioni
      // citano le righe coinvolte, quindi bastano da sole; i messaggi senza riga (chiave ripetuta,
      // carattere riservato…) contano una volta per riga, perché lo stesso errore in due punti
      // sono due errori.
      const key = /\d/.test(message) ? message : `${message}@${lines.indexAt(from)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      problems.push({ from, to, severity: severityOf(err), message });
    }
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
        // "- platform:template" è un testo, non una chiave: manca lo spazio dopo i due punti.
        // Solo per chiavi tipiche di HA: «- mdi:home» in un elenco di icone è un testo voluto.
        const candidate = typeof key === 'number' ? /^([A-Za-z_][\w-]*):([^\s:/].*)$/.exec(source) : null;
        const missing = candidate && HA_KEYS.has(candidate[1]!) ? candidate : null;
        if (missing) {
          warnings.push({
            from: range[0],
            to: range[1],
            severity: 'warning',
            message: t('yaml.explain.missingSpace', { key: missing[1]!, value: missing[2]! }),
          });
        }
      },
    });
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
  return problems.sort((a, b) => a.from - b.from);
}
