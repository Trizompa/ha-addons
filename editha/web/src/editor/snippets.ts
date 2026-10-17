/**
 * Snippet predefiniti, con la sintassi attuale di Home Assistant (triggers / conditions /
 * actions, "action:" al posto di "service:"). I campi ${...} si percorrono con Tab;
 * un valore che contiene ":" va scritto ${n:valore}, altrimenti CodeMirror lo spezza;
 * {{ID}} diventa un identificativo unico al momento dell'inserimento.
 */
import { t, type MessageKey } from '../i18n/index.js';

export interface BuiltinSnippet {
  id: string;
  name: string;
  description: string;
  body: string;
}

interface SnippetDef {
  id: string;
  key: string;
  /** Testo con segnaposto [[chiave]] per le parti da tradurre. */
  body: string;
}

const DEFS: SnippetDef[] = [
  {
    id: 'automation',
    key: 'snip.automation',
    body: `- id: "{{ID}}"
  alias: \${[[ph.automationName]]}
  description: ""
  triggers:
    - trigger: state
      entity_id: \${binary_sensor.[[ph.example]]}
      to: "on"
  conditions: []
  actions:
    - action: \${light.turn_on}
      target:
        entity_id: \${light.[[ph.example]]}
  mode: single
`,
  },
  {
    id: 'script',
    key: 'snip.script',
    body: `\${[[ph.scriptId]]}:
  alias: \${[[ph.scriptName]]}
  sequence:
    - action: \${light.turn_on}
      target:
        entity_id: \${light.[[ph.example]]}
  mode: single
`,
  },
  {
    id: 'template-sensor',
    key: 'snip.templateSensor',
    body: `template:
  - sensor:
      - name: \${[[ph.sensorName]]}
        unique_id: "{{ID}}"
        unit_of_measurement: "\${°C}"
        state: "{{ states('\${sensor.[[ph.example]]}') | float(0) }}"
`,
  },
  {
    id: 'template-binary-sensor',
    key: 'snip.templateBinary',
    body: `template:
  - binary_sensor:
      - name: \${[[ph.sensorName]]}
        unique_id: "{{ID}}"
        state: "{{ is_state('\${binary_sensor.[[ph.example]]}', 'on') }}"
`,
  },
  {
    id: 'trigger-state',
    key: 'snip.triggerState',
    body: `- trigger: state
  entity_id: \${binary_sensor.[[ph.example]]}
  to: "\${on}"
`,
  },
  {
    id: 'trigger-time',
    key: 'snip.triggerTime',
    body: `- trigger: time
  at: "\${1:07:00:00}"
`,
  },
  {
    id: 'trigger-numeric',
    key: 'snip.triggerNumeric',
    body: `- trigger: numeric_state
  entity_id: \${sensor.[[ph.example]]}
  above: \${25}
`,
  },
  {
    id: 'condition-state',
    key: 'snip.conditionState',
    body: `- condition: state
  entity_id: \${person.[[ph.example]]}
  state: "\${home}"
`,
  },
  {
    id: 'condition-time',
    key: 'snip.conditionTime',
    body: `- condition: time
  after: "\${1:08:00:00}"
  before: "\${2:22:00:00}"
  weekday:
    - mon
    - tue
    - wed
    - thu
    - fri
`,
  },
  {
    id: 'action-service',
    key: 'snip.actionService',
    body: `- action: \${light.turn_on}
  target:
    entity_id: \${light.[[ph.example]]}
  data:
    brightness_pct: \${80}
`,
  },
  {
    id: 'action-notify',
    key: 'snip.actionNotify',
    body: `- action: notify.\${[[ph.phone]]}
  data:
    title: "\${[[ph.title]]}"
    message: "\${[[ph.message]]}"
`,
  },
  {
    id: 'action-delay',
    key: 'snip.actionDelay',
    body: `- delay:
    minutes: \${5}
`,
  },
  {
    id: 'action-choose',
    key: 'snip.actionChoose',
    body: `- choose:
    - conditions:
        - condition: state
          entity_id: \${binary_sensor.[[ph.example]]}
          state: "on"
      sequence:
        - action: \${light.turn_on}
          target:
            entity_id: \${light.[[ph.example]]}
  default:
    - action: \${light.turn_off}
      target:
        entity_id: \${light.[[ph.example]]}
`,
  },
  {
    id: 'input-boolean',
    key: 'snip.inputBoolean',
    body: `input_boolean:
  \${[[ph.toggleId]]}:
    name: \${[[ph.name]]}
    icon: mdi:\${toggle-switch}
`,
  },
  {
    id: 'input-number',
    key: 'snip.inputNumber',
    body: `input_number:
  \${[[ph.numberId]]}:
    name: \${[[ph.name]]}
    min: \${0}
    max: \${100}
    step: \${1}
    unit_of_measurement: "\${°C}"
`,
  },
];

/** Snippet predefiniti nella lingua corrente. */
export function builtinSnippets(): BuiltinSnippet[] {
  return DEFS.map((d) => ({
    id: d.id,
    name: t(d.key as MessageKey),
    description: t(`${d.key}.desc` as MessageKey),
    body: d.body.replace(/\[\[([\w.]+)\]\]/g, (_m, key: string) => t(key as MessageKey)),
  }));
}

/** Identificativo unico per automazioni e unique_id, come quelli generati da HA. */
export function fillIds(body: string, now = Date.now()): string {
  return body.replaceAll('{{ID}}', String(now));
}

/**
 * Testo selezionato da salvare come snippet. Se la selezione parte dopo il rientro della sua
 * prima riga (`firstLineColumn` = colonna d'inizio, quando prima c'è solo rientro; 0 altrimenti),
 * la prima riga è senza rientro e le altre lo hanno ancora: si toglie lo stesso rientro anche
 * a quelle, così all'inserimento la struttura resta giusta. Si tolgono solo spazi, mai testo.
 */
export function normalizeSnippetBody(text: string, firstLineColumn: number): string {
  if (firstLineColumn <= 0) return text;
  const lines = text.split('\n');
  return lines
    .map((line, i) => {
      if (i === 0) return line;
      const lead = /^[ \t]*/.exec(line)![0].length;
      return line.slice(Math.min(lead, firstLineColumn));
    })
    .join('\n');
}
