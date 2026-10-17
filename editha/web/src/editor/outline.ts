import { LineCounter, isMap, isPair, isScalar, isSeq, parseDocument, type Node, type YAMLMap } from 'yaml';

/** Una voce dello schema del file (ED-18): riga a cui saltare e rientro nell'elenco. */
export interface OutlineItem {
  label: string;
  /** Testo secondario, es. la chiave quando l'etichetta è l'alias. */
  detail?: string;
  line: number;
  depth: 0 | 1;
}

const MAX_LABEL = 80;

/** Oltre questa lunghezza (circa 1 MB) lo schema non si costruisce: l'editor resterebbe bloccato. */
export const OUTLINE_MAX_CHARS = 1_000_000;

/** Schema del file; `tooLarge` se il file supera OUTLINE_MAX_CHARS (l'elenco è vuoto). */
export type Outline = OutlineItem[] & { tooLarge?: boolean };

function short(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > MAX_LABEL ? one.slice(0, MAX_LABEL - 1) + '…' : one;
}

/** Valore testuale di una chiave di una mappa, se è un testo semplice. */
function text(map: YAMLMap, key: string): string | null {
  const v = map.get(key, true);
  if (!isScalar(v) || v.value === null || typeof v.value === 'object') return null;
  const s = String(v.value).trim();
  return s ? s : null;
}

function keyText(node: unknown): string | null {
  if (!isScalar(node)) return null;
  return node.value === null ? null : String(node.value);
}

/** Etichetta di un elemento: alias o nome, altrimenti la prima coppia "chiave: valore". */
function itemLabel(node: unknown, index: number): { label: string; detail?: string } {
  if (isMap(node)) {
    // L'id generato da HA è un numero lungo che non dice niente: basta l'alias.
    const named = text(node, 'alias') ?? text(node, 'name');
    if (named) return { label: named };
    const id = text(node, 'id');
    if (id) return { label: id };
    const first = node.items[0];
    if (first && isPair(first)) {
      const k = keyText(first.key);
      const v = isScalar(first.value) ? keyText(first.value) : null;
      if (k) return { label: v ? `${k}: ${v}` : k };
    }
  }
  if (isScalar(node) && node.value !== null) return { label: String(node.value) };
  return { label: `#${index + 1}` };
}

/**
 * Una mappa di oggetti con un nome (script, helper, …) merita le sue voci: tutti i valori sono
 * mappe (o vuoti, come un input_boolean senza opzioni). Le impostazioni di uno script senza alias
 * (sequence, fields, mode) non sono voci.
 */
function hasNamedChildren(map: YAMLMap): boolean {
  const values = map.items.map((p) => (isPair(p) ? p.value : undefined));
  return values.some((v) => isMap(v)) && values.every((v) => isMap(v) || v === null || (isScalar(v) && v.value === null));
}

function startLine(node: Node | null | undefined, lc: LineCounter): number | null {
  const start = node?.range?.[0];
  return typeof start === 'number' ? lc.linePos(start).line : null;
}

/**
 * Voci principali di un file YAML: le chiavi di primo livello (con alias, se c'è) e, un livello
 * sotto, gli elementi delle liste e delle mappe di oggetti. Così in `automations.yaml` si vede
 * l'elenco delle automazioni, in `scripts.yaml` quello degli script, in un package le sezioni con
 * le automazioni dentro. Un file troppo grande dà un elenco vuoto segnato `tooLarge`.
 */
export function buildOutline(source: string): Outline {
  if (source.length > OUTLINE_MAX_CHARS) return Object.assign([] as OutlineItem[], { tooLarge: true });
  const lc = new LineCounter();
  const doc = parseDocument(source, { lineCounter: lc, prettyErrors: false, uniqueKeys: false });
  const out: OutlineItem[] = [];
  const root = doc.contents;

  const children = (value: unknown): void => {
    if (isSeq(value)) {
      value.items.forEach((item, i) => {
        const line = startLine(item as Node, lc);
        if (line !== null && (isMap(item) || isScalar(item))) out.push({ ...short2(itemLabel(item, i)), line, depth: 1 });
      });
    } else if (isMap(value) && hasNamedChildren(value)) {
      for (const pair of value.items) {
        if (!isPair(pair)) continue;
        const key = keyText(pair.key);
        const line = startLine(pair.key as Node, lc);
        if (key === null || line === null) continue;
        const named = isMap(pair.value) ? (text(pair.value, 'alias') ?? text(pair.value, 'name')) : null;
        out.push({ ...short2(named ? { label: named, detail: key } : { label: key }), line, depth: 1 });
      }
    }
  };

  if (isSeq(root)) {
    root.items.forEach((item, i) => {
      const line = startLine(item as Node, lc);
      if (line !== null) out.push({ ...short2(itemLabel(item, i)), line, depth: 0 });
    });
  } else if (isMap(root)) {
    for (const pair of root.items) {
      if (!isPair(pair)) continue;
      const key = keyText(pair.key);
      const line = startLine(pair.key as Node, lc);
      if (key === null || line === null) continue;
      // Al primo livello conta solo l'alias (script): "name" è spesso un'impostazione (homeassistant).
      const named = isMap(pair.value) ? text(pair.value, 'alias') : null;
      out.push({ ...short2(named ? { label: named, detail: key } : { label: key }), line, depth: 0 });
      // Un oggetto con nome (uno script in scripts.yaml) non si apre: basta la sua voce.
      if (!named) children(pair.value);
    }
  }
  return out;
}

function short2(item: { label: string; detail?: string }): { label: string; detail?: string } {
  return item.detail ? { label: short(item.label), detail: short(item.detail) } : { label: short(item.label) };
}

/** Indice della voce in cui si trova il cursore: l'ultima che inizia prima della sua riga. */
export function activeOutlineIndex(items: OutlineItem[], line: number): number {
  let found = -1;
  for (let i = 0; i < items.length; i++) {
    if (items[i]!.line <= line) found = i;
    else break;
  }
  return found;
}
