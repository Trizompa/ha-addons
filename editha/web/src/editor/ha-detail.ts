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
  /** Cosa va scritto al cursore; null: il cursore è solo nel blocco di un'entità (pannello Inserisci). */
  kind: 'attribute' | 'state' | null;
  /** Entità di cui suggerire attributi o stati. */
  entities: string[];
  /** Quanti caratteri prima del cursore sostituisce il suggerimento. */
  typed: number;
  /** Virgolette già aperte prima del valore ('' se nessuna). */
  quote: '' | '"' | "'";
  /** Dentro un template Jinja: le virgolette sono quelle di Jinja, non dello YAML. */
  template: boolean;
  /** Chiave dopo cui si scrive («to», «attribute»…); null nei template e nel solo blocco. */
  key: string | null;
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
function blockEntities(lines: string[], at: number, col: number, self = false): { entities: string[]; attribute: boolean } {
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
      if (i !== at || self) collect(i, kl);
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

/** Valore che si sta scrivendo: parole con «.» e «-», anche separate da spazi (opzioni come «Fuori casa»). */
const VALUE = String.raw`[\w.-]*(?: [\w.-]*)*`;
/** «chiave: valore» con il cursore nel valore. */
const KEY_VALUE = new RegExp(String.raw`^(\s*)((?:-\s+)*)([A-Za-z_][\w-]*)\s*:\s+(["']?)(${VALUE})$`);
/** «- valore» in un elenco. */
const ITEM_VALUE = new RegExp(String.raw`^(\s*)-\s+(["']?)(${VALUE})$`);

/** Template: state_attr('x', '…'), is_state_attr('x', '…'), states.x.attributes.…, is_state('x', '…'). */
function templateContext(before: string): DetailContext | null {
  const tpl = (kind: 'attribute' | 'state', id: string, quote: string, typed: string): DetailContext => ({
    kind,
    entities: [id],
    typed: typed.length,
    quote: quote as "'" | '"',
    template: true,
    key: null,
  });
  const attr = /\b(?:state_attr|is_state_attr)\(\s*['"]([a-z_][a-z0-9_]*\.[a-z0-9_]+)['"]\s*,\s*(['"])(\w*)$/.exec(before);
  if (attr) return tpl('attribute', attr[1]!, attr[2]!, attr[3]!);
  const dotted = /\bstates\.([a-z_][a-z0-9_]*\.[a-z0-9_]+)\.attributes\.(\w*)$/.exec(before);
  // Qui l'attributo è un nome in un'espressione, non un testo: niente virgolette.
  if (dotted) return { ...tpl('attribute', dotted[1]!, '', dotted[2]!), quote: '' };
  const state = /\bis_state\(\s*['"]([a-z_][a-z0-9_]*\.[a-z0-9_]+)['"]\s*,\s*(['"])([\w -]*)$/.exec(before);
  if (state) return tpl('state', state[1]!, state[2]!, state[3]!);
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
  const m = KEY_VALUE.exec(before);
  if (m) {
    const key = m[3]!;
    if (key !== 'attribute' && !STATE_KEYS.has(key)) return null;
    const col = m[1]!.length + m[2]!.length;
    const block = blockEntities(lines, index, col);
    if (block.entities.length === 0) return null;
    if (key !== 'attribute' && block.attribute) return null;
    return {
      kind: key === 'attribute' ? 'attribute' : 'state',
      entities: block.entities,
      typed: m[5]!.length,
      quote: m[4] as DetailContext['quote'],
      template: false,
      key,
    };
  }
  // «- valore» in un elenco sotto «state:» / «to:» / «from:».
  const item = ITEM_VALUE.exec(before);
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
    return { kind: 'state', entities: block.entities, typed: item[3]!.length, quote: item[2] as DetailContext['quote'], template: false, key: kl.key };
  }
  return null;
}

/** Inizio del valore: «chiave:» (con gli eventuali trattini davanti) o «-» di un elemento di elenco. */
const VALUE_START = /^(?:\s*(?:-\s+)*[A-Za-z_][\w-]*\s*:|\s*-)([ \t]*)/;

/**
 * Valore intero della riga `index` dopo «state:» / «to:» / «attribute:»… (o «- » sotto di loro), se
 * il cursore (colonna `col`) sta lì: il clic nel pannello lo sostituisce tutto, virgolette comprese.
 * `from`/`to` sono colonne della riga; `space` dice se dopo i due punti manca lo spazio.
 */
export function valueAt(lines: string[], index: number, col: number): { ctx: DetailContext; from: number; to: number; space: boolean } | null {
  const line = lines[index] ?? '';
  const m = VALUE_START.exec(line);
  if (!m) return null;
  const from = m[0].length;
  if (col < from - m[1]!.length) return null;
  // Il contesto si calcola come se il valore fosse vuoto: conta la chiave, non quello che c'è scritto.
  const ctx = detailContext(lines, index, line.slice(0, from - m[1]!.length) + ' ');
  if (!ctx || ctx.template || ctx.kind === null) return null;
  const rest = line.slice(from);
  let len: number;
  const quote = rest[0];
  if (quote === '"' || quote === "'") {
    // Fino alla virgoletta di chiusura ('' e \" sono virgolette dentro il testo).
    const re = quote === '"' ? /^"(?:[^"\\]|\\.)*"?/ : /^'(?:[^']|'')*'?/;
    len = re.exec(rest)![0].length;
  } else {
    len = rest.replace(/\s+#.*$/, '').trimEnd().length;
  }
  return { ctx: { ...ctx, typed: 0, quote: '' }, from, to: from + len, space: m[1] === '' };
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
  /** È lo stato attuale di una delle entità. */
  current: boolean;
}

/** Stati (prima quello attuale) e attributi delle entità `ids`, nell'ordine in cui conviene vederli. */
export function entityDetails(ids: readonly string[], entities: readonly DetailEntity[]): { states: DetailOption[]; attributes: string[] } {
  const found = entities.filter((e) => ids.includes(e.entity_id));
  const states = new Map<string, DetailOption>();
  for (const e of found) states.set(e.state, { label: e.state, current: true });
  for (const e of found) for (const s of e.states ?? []) if (!states.has(s)) states.set(s, { label: s, current: false });
  for (const id of ids) {
    for (const s of DOMAIN_STATES[id.slice(0, id.indexOf('.'))] ?? []) if (!states.has(s)) states.set(s, { label: s, current: false });
  }
  if (states.size > 0) for (const s of COMMON_STATES) if (!states.has(s)) states.set(s, { label: s, current: false });
  const attributes = [...new Set(found.flatMap((e) => e.attributes ?? []))];
  return { states: [...states.values()], attributes };
}

/** Attributi o stati da suggerire al cursore (Ctrl+Spazio). */
export function detailOptions(ctx: DetailContext, entities: readonly DetailEntity[]): DetailOption[] {
  const details = entityDetails(ctx.entities, entities);
  if (ctx.kind === 'attribute') return details.attributes.map((label) => ({ label, current: false }));
  return ctx.kind === 'state' ? details.states : [];
}

/**
 * Entità del blocco dove sta il cursore, per il riquadro del pannello Inserisci: come
 * `detailContext` dopo «attribute:» / «state:», altrimenti l'entità del blocco della riga
 * (anche se il cursore è proprio sulla riga «entity_id:»), con `kind` null.
 */
export function panelContext(lines: string[], index: number, before: string): DetailContext | null {
  const detail = detailContext(lines, index, before);
  if (detail) return detail;
  // La chiave della riga del cursore, o quella più vicina sopra con un rientro non maggiore.
  const indent = indentOf(lines[index] ?? '') || (/^\s*$/.test(before) ? before.length : 0);
  for (let i = index; i >= 0; i--) {
    const line = lines[i]!;
    if (!isContent(line)) continue;
    const kl = keyLine(line);
    if (!kl) continue;
    if (i !== index && kl.col > indent) continue;
    const block = blockEntities(lines, i, kl.col, true);
    if (block.entities.length === 0) return null;
    return { kind: null, entities: block.entities, typed: 0, quote: '', template: false, key: null };
  }
  return null;
}

/** Parole che Home Assistant (YAML 1.1) leggerebbe come vero/falso o vuoto, non come testo. */
const YAML_SPECIAL = new Set(['on', 'off', 'yes', 'no', 'y', 'n', 'true', 'false', 'null', '~']);
/** Testo che lo YAML legge così com'è senza virgolette: parole, anche con spazi, che iniziano con una lettera. */
const PLAIN = /^[A-Za-z_][\w.-]*(?: [\w.-]+)*$/;

/**
 * Testo da inserire per `label`. Negli stati senza virgolette, «on» diventa «"on"» e così ogni
 * valore che lo YAML leggerebbe diversamente (`Fuori: casa`, `#1`, `01`); tra virgolette già
 * aperte si raddoppia o si protegge la virgoletta dentro il testo (`l'ingresso`).
 */
export function insertText(ctx: DetailContext, label: string): string {
  if (ctx.quote === "'") return ctx.template ? label.replace(/'/g, "\\'") : label.replace(/'/g, "''");
  if (ctx.quote === '"') return label.replace(/["\\]/g, (c) => '\\' + c);
  if (ctx.kind !== 'state' || ctx.template) return label;
  return PLAIN.test(label) && !YAML_SPECIAL.has(label.toLowerCase()) ? label : JSON.stringify(label);
}
