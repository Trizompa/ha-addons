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
  /** Parte del documento da cui viene il template. */
  from: number;
  to: number;
}

/** Un template contiene almeno `{{`, `{%` o `{#`. */
export const JINJA = /\{\{|\{%|\{#/;

const BLOCK = new Set(['BLOCK_LITERAL', 'BLOCK_FOLDED']);

/** Il valore di testo che contiene `pos`; sulla chiave di una coppia, il suo valore. */
function scalarAt(doc: string, pos: number): Scalar<string> | null {
  let found = null as Scalar<string> | null;
  for (const d of parseAllDocuments(doc, { prettyErrors: false, uniqueKeys: false, strict: false })) {
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
    found = { template: doc.slice(from, to), line: lineOf(doc, from), from, to };
  } else if (language === 'jinja') {
    found = { template: doc, line: 1, from: 0, to: doc.length };
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
      found = { template: node.value, line: lineOf(doc, body), from: start, to: valueEnd };
    }
  }
  return found && JINJA.test(found.template) ? found : null;
}
