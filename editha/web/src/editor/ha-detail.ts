/**
 * Attributi e stati delle entità nei suggerimenti (HA-12): capisce dal testo se il cursore sta
 * dopo «attribute:», dopo «state:» / «to:» / «from:» o dentro state_attr() / is_state() di un
 * template, e di quali entità si parla. Solo testo: niente CodeMirror, così si prova da sola.
 */

/** Quello che serve di un'entità (EntityInfo del server ha anche nome e unità). */
export interface DetailEntity {
  entity_id: string;
  state: string;
  attributes?: string[];
  states?: string[];
}

export interface DetailContext {
  kind: 'attribute' | 'state';
  /** Entità di cui suggerire attributi o stati. */
  entities: string[];
  /** Quanti caratteri prima del cursore sostituisce il suggerimento. */
  typed: number;
  /** Il valore è già tra virgolette (o dentro un template): «on» si scrive così com'è. */
  quoted: boolean;
}

const STATE_KEYS = new Set(['state', 'to', 'from', 'not_to', 'not_from']);
const ENTITY_KEYS = new Set(['entity_id', 'entity']);
const ENTITY_IN_TEXT = /[a-z_][a-z0-9_]*\.[a-z0-9_]+/g;

/** Riga «  - chiave: valore»: colonna della chiave (dopo gli eventuali trattini), chiave e valore. */
const KEY_LINE = /^(\s*)((?:-\s+)*)([A-Za-z_][\w-]*)\s*:(?:\s+(.*?))?\s*$/;
/** Riga «  - valore» di un elenco. */
const ITEM_LINE = /^(\s*)-\s+(.*?)\s*$/;

interface KeyLine {
  col: number;
  /** Colonna del primo trattino, se la riga apre un elemento di elenco. */
  dash: number | null;
  key: string;
  value: string;
}

function keyLine(line: string): KeyLine | null {
  const m = KEY_LINE.exec(line);
  if (!m) return null;
  return {
    col: m[1]!.length + m[2]!.length,
    dash: m[2] ? m[1]!.length : null,
    key: m[3]!,
    value: (m[4] ?? '').replace(/\s+#.*$/, ''),
  };
}

const isContent = (line: string) => line.trim() !== '' && !line.trimStart().startsWith('#');
const indentOf = (line: string) => /^\s*/.exec(line)![0].length;

/**
 * Entità indicate nel blocco della chiave alla riga `at` (colonna `col`): «entity_id:» o «entity:»
 * allo stesso livello, sopra o sotto, anche come elenco. `attribute` dice se nel blocco c'è anche
 * «attribute:» (allora «state:» è il valore di un attributo, non lo stato dell'entità).
 */
function blockEntities(lines: string[], at: number, col: number): { entities: string[]; attribute: boolean } {
  const entities: string[] = [];
  let attribute = false;
  const collect = (index: number, kl: KeyLine) => {
    if (kl.key === 'attribute') attribute = true;
    if (!ENTITY_KEYS.has(kl.key)) return;
    entities.push(...(kl.value.match(ENTITY_IN_TEXT) ?? []));
    if (kl.value !== '') return;
    // «entity_id:» con l'elenco sotto: righe «- light.x» più rientrate.
    for (let i = index + 1; i < lines.length; i++) {
      const line = lines[i]!;
      if (!isContent(line)) continue;
      const item = ITEM_LINE.exec(line);
      // Una chiave o un elemento meno rientrato della chiave: l'elenco è finito.
      if (!item || keyLine(line) || item[1]!.length < kl.col) break;
      entities.push(...(item[2]!.match(ENTITY_IN_TEXT) ?? []));
    }
  };
  // Verso l'alto fino all'inizio del blocco (la riga con il trattino o una chiave meno rientrata).
  for (let i = at; i >= 0; i--) {
    const line = lines[i]!;
    if (!isContent(line)) continue;
    const kl = keyLine(line);
    if (!kl) {
      if (indentOf(line) < col) break;
      continue;
    }
    if (kl.col < col) break;
    if (kl.col === col) {
      if (i !== at) collect(i, kl);
      if (kl.dash !== null) break;
    }
  }
  // Verso il basso fino al prossimo elemento o alla fine del blocco.
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!isContent(line)) continue;
    const kl = keyLine(line);
    if (!kl) {
      if (indentOf(line) < col) break;
      continue;
    }
    if (kl.col < col || (kl.col === col && kl.dash !== null)) break;
    if (kl.col === col) collect(i, kl);
  }
  return { entities: [...new Set(entities)], attribute };
}

/** Template: state_attr('x', '…'), is_state_attr('x', '…'), states.x.attributes.…, is_state('x', '…'). */
function templateContext(before: string): DetailContext | null {
  const attr = /\b(?:state_attr|is_state_attr)\(\s*['"]([a-z_][a-z0-9_]*\.[a-z0-9_]+)['"]\s*,\s*['"](\w*)$/.exec(before);
  if (attr) return { kind: 'attribute', entities: [attr[1]!], typed: attr[2]!.length, quoted: true };
  const dotted = /\bstates\.([a-z_][a-z0-9_]*\.[a-z0-9_]+)\.attributes\.(\w*)$/.exec(before);
  if (dotted) return { kind: 'attribute', entities: [dotted[1]!], typed: dotted[2]!.length, quoted: true };
  const state = /\bis_state\(\s*['"]([a-z_][a-z0-9_]*\.[a-z0-9_]+)['"]\s*,\s*['"]([\w-]*)$/.exec(before);
  if (state) return { kind: 'state', entities: [state[1]!], typed: state[2]!.length, quoted: true };
  return null;
}

/**
 * Contesto del cursore: `lines` è il documento diviso in righe, `index` la riga del cursore e
 * `before` il testo della riga prima del cursore.
 */
export function detailContext(lines: string[], index: number, before: string): DetailContext | null {
  const tpl = templateContext(before);
  if (tpl) return tpl;
  // «chiave: valore» con il cursore nel valore.
  const m = /^(\s*)((?:-\s+)*)([A-Za-z_][\w-]*)\s*:\s+(["']?)([\w.-]*)$/.exec(before);
  if (m) {
    const key = m[3]!;
    if (key !== 'attribute' && !STATE_KEYS.has(key)) return null;
    const col = m[1]!.length + m[2]!.length;
    const block = blockEntities(lines, index, col);
    if (block.entities.length === 0) return null;
    if (key !== 'attribute' && block.attribute) return null;
    return { kind: key === 'attribute' ? 'attribute' : 'state', entities: block.entities, typed: m[5]!.length, quoted: !!m[4] };
  }
  // «- valore» in un elenco sotto «state:» / «to:» / «from:».
  const item = /^(\s*)-\s+(["']?)([\w.-]*)$/.exec(before);
  if (!item) return null;
  const dash = item[1]!.length;
  for (let i = index - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!isContent(line)) continue;
    const sibling = ITEM_LINE.exec(line);
    if (sibling && sibling[1]!.length === dash && !keyLine(line)) continue;
    const kl = keyLine(line);
    if (!kl || kl.value !== '' || kl.col > dash || !STATE_KEYS.has(kl.key)) return null;
    const block = blockEntities(lines, i, kl.col);
    if (block.entities.length === 0 || block.attribute) return null;
    return { kind: 'state', entities: block.entities, typed: item[3]!.length, quoted: !!item[2] };
  }
  return null;
}

/** Stati tipici per dominio: quelli che Home Assistant non elenca negli attributi. */
const DOMAIN_STATES: Record<string, string[]> = {
  light: ['on', 'off'],
  switch: ['on', 'off'],
  binary_sensor: ['on', 'off'],
  input_boolean: ['on', 'off'],
  fan: ['on', 'off'],
  automation: ['on', 'off'],
  script: ['on', 'off'],
  remote: ['on', 'off'],
  siren: ['on', 'off'],
  humidifier: ['on', 'off'],
  update: ['on', 'off'],
  cover: ['open', 'closed', 'opening', 'closing'],
  valve: ['open', 'closed', 'opening', 'closing'],
  lock: ['locked', 'unlocked', 'locking', 'unlocking', 'jammed', 'open', 'opening'],
  person: ['home', 'not_home'],
  device_tracker: ['home', 'not_home'],
  media_player: ['on', 'off', 'idle', 'playing', 'paused', 'standby', 'buffering'],
  alarm_control_panel: [
    'disarmed', 'armed_home', 'armed_away', 'armed_night', 'armed_vacation', 'armed_custom_bypass',
    'pending', 'arming', 'disarming', 'triggered',
  ],
  vacuum: ['cleaning', 'docked', 'idle', 'paused', 'returning', 'error'],
  lawn_mower: ['mowing', 'docked', 'paused', 'returning', 'error'],
  sun: ['above_horizon', 'below_horizon'],
  timer: ['idle', 'active', 'paused'],
};

/** Stati che ogni entità può avere. */
const COMMON_STATES = ['unavailable', 'unknown'];

export interface DetailOption {
  label: string;
  /** È lo stato attuale di una delle entità: lo dice il testo grigio a destra. */
  current: boolean;
}

/** Attributi o stati da suggerire per le entità del contesto, nell'ordine in cui conviene vederli. */
export function detailOptions(ctx: DetailContext, entities: readonly DetailEntity[]): DetailOption[] {
  const found = entities.filter((e) => ctx.entities.includes(e.entity_id));
  const out = new Map<string, DetailOption>();
  if (ctx.kind === 'attribute') {
    for (const e of found) for (const a of e.attributes ?? []) if (!out.has(a)) out.set(a, { label: a, current: false });
    return [...out.values()];
  }
  for (const e of found) out.set(e.state, { label: e.state, current: true });
  for (const e of found) for (const s of e.states ?? []) if (!out.has(s)) out.set(s, { label: s, current: false });
  for (const id of ctx.entities) {
    for (const s of DOMAIN_STATES[id.slice(0, id.indexOf('.'))] ?? []) if (!out.has(s)) out.set(s, { label: s, current: false });
  }
  if (out.size === 0) return [];
  for (const s of COMMON_STATES) if (!out.has(s)) out.set(s, { label: s, current: false });
  return [...out.values()];
}

/** Valori che Home Assistant (YAML 1.1) leggerebbe come vero/falso: vanno tra virgolette. */
const YAML11_BOOLEANS = new Set(['on', 'off', 'yes', 'no', 'true', 'false']);

/** Testo da inserire: «on» diventa «"on"» se il valore non è già tra virgolette. */
export function insertText(ctx: DetailContext, label: string): string {
  return ctx.kind === 'state' && !ctx.quoted && YAML11_BOOLEANS.has(label.toLowerCase()) ? `"${label}"` : label;
}
