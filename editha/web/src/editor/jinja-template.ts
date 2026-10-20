import { isPair, isScalar, parseAllDocuments, visit, type Scalar } from 'yaml';

/**
 * HA-7: quale template mandare all'anteprima. Con una selezione, il testo selezionato; in un file
 * Jinja, il file intero; in un file YAML, il valore sotto il cursore, letto dal parser YAML come
 * lo legge Home Assistant (blocchi `|` e `>`, virgolette, sequenze di escape, righe ripiegate).
 */

export interface TemplateSource {
  template: string;
  /** Riga del documento (da 1) dove inizia il template. */
  line: number;
  /** Le righe del template sono quelle del documento, una per una (selezione, file Jinja, blocco |). */
  linear: boolean;
  /** Parte del documento da cui viene il template. */
  from: number;
  to: number;
}

/** Un template contiene almeno `{{`, `{%` o `{#`. */
export const JINJA = /\{\{|\{%|\{#/;

const BLOCK = new Set(['BLOCK_LITERAL', 'BLOCK_FOLDED']);

/** Ultimo documento letto: spostando il cursore nello stesso testo non si rilegge tutto. */
let parsed: { doc: string; docs: ReturnType<typeof parseAllDocuments> } | null = null;

function documents(doc: string): ReturnType<typeof parseAllDocuments> {
  if (parsed?.doc !== doc) parsed = { doc, docs: parseAllDocuments(doc, { prettyErrors: false, uniqueKeys: false, strict: false }) };
  return parsed.docs;
}

/** Il valore di testo che contiene `pos`; sulla chiave di una coppia, il suo valore. */
function scalarAt(doc: string, pos: number): Scalar<string> | null {
  let found = null as Scalar<string> | null;
  const docs = documents(doc);
  for (const d of Array.isArray(docs) ? docs : [docs]) {
    if (!('contents' in d)) continue;
    visit(d, {
      Scalar(key, node, path) {
        const range = node.range;
        if (!range || typeof node.value !== 'string') return;
        // Un blocco | o > arriva fino all'ultima riga del suo contenuto, righe vuote comprese.
        const end = BLOCK.has(node.type ?? '') ? range[2] : range[1];
        if (pos < range[0] || pos > end) return;
        const parent = path[path.length - 1];
        if (key === 'key' && isPair(parent)) {
          const value = parent.value;
          if (isScalar(value) && typeof value.value === 'string') found = value as Scalar<string>;
        } else found = node as Scalar<string>;
        return visit.BREAK;
      },
    });
    if (found) break;
  }
  return found;
}

const lineOf = (doc: string, pos: number) => doc.slice(0, pos).split('\n').length;

/**
 * Template da mandare all'anteprima: la selezione, il file Jinja intero o il valore YAML sotto il
 * cursore. null se lì non c'è un template (niente `{{`, `{%` o `{#`).
 */
export function templateAt(doc: string, from: number, to: number, language: string): TemplateSource | null {
  let found: TemplateSource | null = null;
  if (to > from) {
    found = { template: doc.slice(from, to), line: lineOf(doc, from), linear: true, from, to };
  } else if (language === 'jinja') {
    found = { template: doc, line: 1, linear: true, from: 0, to: doc.length };
  } else if (language === 'yaml') {
    // Il cursore può stare prima del valore (rientro, "- ") o dopo (spazi in fondo alla riga).
    const lineStart = doc.lastIndexOf('\n', from - 1) + 1;
    const nl = doc.indexOf('\n', from);
    const lineEnd = nl === -1 ? doc.length : nl > 0 && doc[nl - 1] === '\r' ? nl - 1 : nl;
    const firstChar = lineStart + (/^[ \t-]*/.exec(doc.slice(lineStart, lineEnd))![0].length);
    // Dopo il valore possono esserci spazi e un commento: si prova anche dove finisce il testo.
    const content = lineStart + doc.slice(lineStart, lineEnd).replace(/\s+#.*$/, '').trimEnd().length;
    const node =
      scalarAt(doc, from) ??
      scalarAt(doc, Math.max(from, firstChar)) ??
      scalarAt(doc, lineEnd) ??
      scalarAt(doc, content);
    if (node?.range) {
      const [start, valueEnd] = node.range;
      // Nei blocchi | e > il template comincia sulla riga dopo l'indicatore.
      const body = BLOCK.has(node.type ?? '') ? doc.indexOf('\n', start) + 1 || start : start;
      // Le righe coincidono con quelle del file nei blocchi | e nei valori scritti su una riga sola.
      const linear = node.type === 'BLOCK_LITERAL' || (node.type !== 'BLOCK_FOLDED' && !doc.slice(start, valueEnd).includes('\n'));
      found = { template: node.value, line: lineOf(doc, body), linear, from: start, to: valueEnd };
    }
  }
  return found && JINJA.test(found.template) ? found : null;
}

/** Riga (da 1) dove inizia `pos` nel template. */
const templateLine = (template: string, pos: number) => template.slice(0, pos).split('\n').length;

const OPENERS = new Set(['if', 'for', 'macro', 'call', 'filter', 'raw', 'with', 'block', 'set']);
const MIDDLE: Record<string, string[]> = { elif: ['if'], else: ['if', 'for'] };

/**
 * Riga probabile di un errore di sintassi, perché Home Assistant non la indica: un `{{`, `{%` o
 * `{#` che non si chiude, un `{% end… %}` senza apertura o un blocco aperto e mai chiuso.
 * null se l'errore è di un altro tipo (lo dice solo Jinja).
 */
export function syntaxErrorLine(template: string): number | null {
  const stack: { tag: string; pos: number }[] = [];
  const re = /\{(\{|%|#)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template))) {
    // Dentro {% raw %} non si interpreta niente fino a {% endraw %}.
    if (stack.at(-1)?.tag === 'raw') {
      const endraw = /\{%[-+]?\s*endraw\s*[-+]?%\}/g;
      endraw.lastIndex = m.index;
      const e = endraw.exec(template);
      if (!e) break;
      stack.pop();
      re.lastIndex = e.index + e[0].length;
      continue;
    }
    const close = m[1] === '{' ? '}}' : m[1] === '%' ? '%}' : '#}';
    const end = template.indexOf(close, m.index + 2);
    if (end < 0) return templateLine(template, m.index);
    re.lastIndex = end + 2;
    if (m[1] !== '%') continue;
    const body = template.slice(m.index + 2, end).replace(/^[-+]/, '').trim();
    const tag = /^\w+/.exec(body)?.[0] ?? '';
    if (tag === 'set' && body.includes('=')) continue;
    if (OPENERS.has(tag)) stack.push({ tag, pos: m.index });
    else if (tag.startsWith('end')) {
      if (stack.at(-1)?.tag !== tag.slice(3)) return templateLine(template, m.index);
      stack.pop();
    } else if (MIDDLE[tag] && !MIDDLE[tag].includes(stack.at(-1)?.tag ?? '')) {
      return templateLine(template, m.index);
    }
  }
  const open = stack.at(-1);
  return open ? templateLine(template, open.pos) : null;
}

/** Funzioni dei template che ricevono un entity_id come primo argomento. */
const ENTITY_FN = /\b(?:states|is_state|state_attr|is_state_attr|has_value|state_translated|expand|device_id)\(\s*(['"])([a-z_]+\.[a-z0-9_]+)\1/g;
const STATES_DOT = /\bstates\.([a-z_]+)\.([a-z0-9_]+)\b/g;

/** Entità citate nel template (in states('…'), is_state('…'), states.dominio.nome…). */
export function entitiesIn(template: string): string[] {
  // Commenti e blocchi raw non sono codice; per states.x.y conta solo il codice dentro {{ }} e
  // {% %}, senza il testo tra virgolette (fuori, un apostrofo è solo testo).
  const code = template.replace(/\{#[\s\S]*?#\}/g, ' ').replace(/\{%[-+]?\s*raw\s*[-+]?%\}[\s\S]*?\{%[-+]?\s*endraw\s*[-+]?%\}/g, ' ');
  const unquoted = (code.match(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g) ?? [])
    .map((tag) => tag.replace(/'[^'\n]*'|"[^"\n]*"/g, ' '))
    .join(' ');
  const found = new Set<string>();
  for (const m of code.matchAll(ENTITY_FN)) found.add(m[2]!);
  for (const m of unquoted.matchAll(STATES_DOT)) found.add(`${m[1]}.${m[2]}`);
  return [...found];
}
