// Avvia il server compilato su una /config di prova (usato da playwright.config.ts).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { access } from 'node:fs/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.EDITHA_E2E_ROOT;
const configDir = path.join(root, 'config');
const dataDir = path.join(root, 'data');

const files = {
  'configuration.yaml': 'homeassistant:\n  name: Casa\n\nautomation: !include automations.yaml\n',
  'automations.yaml': '[]\n',
  'tabs/a.yaml': 'contenuto: A\n',
  'tabs/b.yaml': 'contenuto: B\n',
  'tabs/c.yaml': 'contenuto: C\n',
  'rename/vecchio.yaml': 'x: 1\n',
  'history/luci.yaml': 'luce: spenta\n',
  'drafts/recupera.yaml': 'stato: salvato\n',
  'split/sinistra.yaml': 'lato: sinistra\n',
  'split/destra.yaml': 'lato: destra\n',
  'split/fermo.yaml': 'lato: fermo\n',
  'links/main.yaml': 'automation: !include auto.yaml\nsensor: !include_dir_merge_list sensori\napi_key: !secret chiave_due\n',
  'links/auto.yaml': '- alias: incluso\n',
  'move/da_spostare.yaml': 'spostato: si\n',
  'race/doppio.yaml': 'base: 1\n',
  'sost/uno.yaml': 'luce: light.vecchia\n',
  'confronta/prima.yaml': 'nome: casa\nstanze: 3\n',
  'confronta/dopo.yaml': 'nome: casa\nstanze: 4\n',
  'sost/due.yaml': 'target: light.vecchia\naltro: light.vecchia_2\n',
  'sost/aperto.yaml': 'x: light.vecchia\n',
  'cerca/uno.yaml': 'ago_nel_pagliaio: 1\naltro: AGO_NEL_PAGLIAIO\n',
  'cerca/due.yaml': 'target: light.cucina\nlight.cucina_2: no\nvalue: "{{ states.light.cucina.state }}"\n',
  'entita/sbagliata.yaml': 'automation:\n  - triggers:\n      - trigger: state\n        entity_id: light.soggiorn\n',
  'galleria/luce_on.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fc0"/></svg>',
  'galleria/luce_on_v2.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fa0"/></svg>',
  'galleria/porta.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#a50"/></svg>',
  'galleria/note.txt': 'non è un\'immagine\n',
  'galleria/sotto/dentro.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#0af"/></svg>',
  'move/dest/.keep': '',
  'move/cartella/dentro.yaml': 'x: 1\n',
  'links/sensori/a.yaml': '- platform: template\n',
  'template/auto.yaml': [
    '- alias: Prova',
    '  conditions:',
    '    - condition: template',
    '      value_template: "{{ states(\'light.cucina\') }}"',
    '  actions:',
    '    - action: notify.x',
    '      data:',
    '        message: |',
    '          Luce: {{ states(\'light.cucina\') }}',
    '          {% if true %}',
    '        title: "{{ 1 / 0 }}"',
    '',
  ].join('\n'),
  'links/secrets.yaml': 'chiave_uno: valore_segreto_1\nchiave_due: valore_segreto_2\n',
  'lint/problemi.yaml': 'trigger:\n  - platform: state\n    to: on\naction:\n  - service:light.turn_on\n',
  'drafts/scarta.yaml': 'stato: salvato\n',
  'drafts/sparisce.yaml': 'stato: salvato\n',
  'drafts/dopo.yaml': 'stato: salvato\n',
  'drafts/due-finestre.yaml': 'stato: salvato\n',
  'drafts/conteso.yaml': 'stato: salvato\n',
  'spazio/pesante.yaml': 'a: 1\n',
  'spazio/pulisci.yaml': 'a: 1\n',
  'crlf/windows.yaml': 'a: 1\r\nb: 2\r\n',
  'crlf/misto.yaml': 'a: 1\r\nb: 2\nc: 3\n',
  'dup/originale.yaml': 'copia: no\n',
  'dup/telefono.yaml': 't: 1\n',
  'unsaved/file.yaml': 'originale: true\n',
  'indent/file.yaml': 'uno: 1\ndue: 2\ntre: 3\n',
  'conflict/file.yaml': 'versione: editha\n',
  'delete/via.yaml': 'via: true\n',
  'long/lungo.yaml': Array.from({ length: 300 }, (_, i) => `riga_${i + 1}: ${i + 1}`).join('\n') + '\n',
  'session/uno.yaml': 'uno: 1\n',
  'session/due.yaml': 'due: 2\n',
  'upload/esistente.yaml': 'vecchio: 1\n',
  'drop/.keep': '',
  '.storage/core.config': '{}\n',
  'anteprima/foto.png': Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAEElEQVR4nGP8zwAFTDAGAwATKQED8NgHhAAAAABJRU5ErkJggg==', 'base64'),
  'schema/automazioni.yaml': '- id: "1"\n  alias: Luci al tramonto\n  triggers: []\n\n- id: "2"\n  alias: Buonanotte\n  triggers: []\n\n- id: "3"\n  alias: Porta aperta\n  triggers: []\n',
  'schema/note.txt': 'testo\n',
  'anteprima/icona.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>\n',
  'anteprima/manuale.pdf': '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
};
for (let i = 1; i <= 60; i++) files[`many/file_${String(i).padStart(2, '0')}.yaml`] = `n: ${i}\n`;

for (const [rel, content] of Object.entries(files)) {
  const abs = path.join(configDir, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content);
}
await mkdir(path.join(configDir, 'vuota'), { recursive: true });
await mkdir(path.join(configDir, 'sempre-vuota'), { recursive: true });
await mkdir(dataDir, { recursive: true });
// BK-7: una versione vecchia di due anni da eliminare con la pulizia della cronologia.
{
  const key = createHash('sha256').update('spazio/pulisci.yaml').digest('hex');
  const dir = path.join(dataDir, 'backups', key);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.json'), JSON.stringify({ path: 'spazio/pulisci.yaml' }) + '\n');
  await writeFile(path.join(dir, '20200101T000000000Z-save'), 'vecchia: si\n');
}

// Finto Home Assistant Core: la configurazione è "non valida" finché esiste check/rotto.yaml.
const HA_TOKEN = 'e2e-token';
const haCalls = [];
const fakeHa = http.createServer(async (req, res) => {
  const json = (data) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(data));
  if (req.url === '/_calls') return json(haCalls);
  if (req.headers.authorization !== `Bearer ${HA_TOKEN}`) return res.writeHead(401).end();
  haCalls.push(`${req.method} ${req.url}`);
  if (req.url === '/api/states') {
    return json([
      { entity_id: 'light.cucina', state: 'on', attributes: { friendly_name: 'Luce cucina' } },
      { entity_id: 'light.soggiorno', state: 'off', attributes: { friendly_name: 'Luce soggiorno' } },
      { entity_id: 'sensor.temperatura', state: '21.5', attributes: { friendly_name: 'Temperatura', unit_of_measurement: '°C' } },
      {
        entity_id: 'climate.salotto',
        state: 'heat',
        attributes: { friendly_name: 'Termostato', hvac_modes: ['off', 'heat', 'cool'], hvac_action: 'heating', current_temperature: 20 },
      },
    ]);
  }
  if (req.url === '/api/services') return json([{ domain: 'light', services: { turn_on: { name: 'Accendi' } } }]);
  if (req.url === '/api/config/core/check_config') {
    const broken = await access(path.join(configDir, 'check/rotto.yaml')).then(() => true, () => false);
    return json(broken ? { result: 'invalid', errors: 'Invalid config for [light] at check/rotto.yaml, line 1' } : { result: 'valid', errors: null });
  }
  if (req.url?.startsWith('/api/services/homeassistant/')) return json([]);
  if (req.method === 'POST' && req.url === '/api/template') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const { template } = JSON.parse(raw);
    const fail = (message) => res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ message }));
    if (template.includes('{% if') && !template.includes('endif')) {
      return fail("Error rendering template: TemplateSyntaxError: Unexpected end of template. Jinja was looking for the following tags: 'endif'.");
    }
    if (template.includes('1 / 0')) return fail('Error rendering template: ZeroDivisionError: division by zero');
    const states = { 'light.cucina': 'on' };
    const out = template.replace(/\{\{\s*states\('([^']+)'\)\s*\}\}/g, (_m, id) => states[id] ?? 'unknown');
    return res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(out);
  }
  res.writeHead(404).end();
});
await new Promise((r) => fakeHa.listen(Number(process.env.EDITHA_FAKE_HA_PORT ?? 8097), '127.0.0.1', r));

const server = spawn(process.execPath, [path.join(here, '../../server/dist/main.js')], {
  stdio: 'inherit',
  env: {
    ...process.env,
    EDITHA_CONFIG_DIR: configDir,
    EDITHA_DATA_DIR: dataDir,
    EDITHA_WEB_DIR: path.join(here, '../dist'),
    EDITHA_HOST: '127.0.0.1',
    EDITHA_ALLOWED_IPS: '127.0.0.1,::1',
    EDITHA_LOG_LEVEL: 'warn',
    EDITHA_HA_URL: `http://127.0.0.1:${process.env.EDITHA_FAKE_HA_PORT ?? 8097}/api`,
    EDITHA_HA_TOKEN: HA_TOKEN,
  },
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { fakeHa.close(); server.kill(sig); });
server.on('exit', (code) => process.exit(code ?? 0));
