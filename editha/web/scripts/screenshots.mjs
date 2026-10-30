// Screenshots for the documentation (docs/images). Usage, from editha/web:
//   npm run build && npm --prefix ../server run build && node scripts/screenshots.mjs
// Starts Editha on a sample /config with a fake Home Assistant Core, then drives the UI with Playwright.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../../docs/images');
const PORT = 8095;
const HA_PORT = 8094;
const BASE = `http://127.0.0.1:${PORT}/`;

const files = {
  'configuration.yaml': `# Main Home Assistant configuration
homeassistant:
  name: Home
  unit_system: metric
  time_zone: Europe/Rome
  packages: !include_dir_named packages

default_config:

frontend:
  themes: !include_dir_merge_named themes

http:
  use_x_forwarded_for: true
  trusted_proxies:
    - 172.30.33.0/24

automation: !include automations.yaml
script: !include scripts.yaml
scene: !include scenes.yaml

template:
  - sensor:
      - name: "Average temperature"
        unit_of_measurement: "°C"
        state: >-
          {{ ((states('sensor.living_room_temperature') | float(0)
             + states('sensor.bedroom_temperature') | float(0)) / 2) | round(1) }}

notify:
  - platform: smtp
    name: email
    server: smtp.example.com
    port: 587
    username: !secret smtp_username
    password: !secret smtp_password
    recipient: !secret smtp_recipient
`,
  'automations.yaml': `- id: "1700000000001"
  alias: Living room lights at sunset
  description: Turns on the living room lights when the sun sets and someone is home
  triggers:
    - trigger: sun
      event: sunset
      offset: "-00:15:00"
  conditions:
    - condition: state
      entity_id: group.family
      state: home
  actions:
    - action: light.turn_on
      target:
        entity_id: light.living_room
      data:
        brightness_pct: 70
        transition: 5
  mode: single

- id: "1700000000002"
  alias: Good night
  description: Everything off at bedtime
  triggers:
    - trigger: time
      at: "23:30:00"
  actions:
    - action: light.turn_off
      target:
        area_id: ground_floor
    - action: climate.set_temperature
      target:
        entity_id: climate.living_room
      data:
        temperature: 18
  mode: single

- id: "1700000000003"
  alias: Door left open
  triggers:
    - trigger: state
      entity_id: binary_sensor.front_door
      to: "on"
      for: "00:05:00"
  actions:
    - action: notify.mobile_app_phone
      data:
        title: Front door
        message: The front door has been open for 5 minutes
  mode: restart
`,
  'scripts.yaml': `movie_night:
  alias: Movie night
  icon: mdi:movie-open
  sequence:
    - action: light.turn_on
      target:
        entity_id: light.living_room
      data:
        brightness_pct: 15
    - action: media_player.turn_on
      target:
        entity_id: media_player.living_room_tv
`,
  'scenes.yaml': `- name: Relax
  entities:
    light.living_room:
      state: "on"
      brightness: 90
`,
  'secrets.yaml': `smtp_username: me@example.com
smtp_password: not-a-real-password
smtp_recipient: me@example.com
`,
  'packages/heating.yaml': `# Heating package
input_number:
  comfort_temperature:
    name: Comfort temperature
    min: 16
    max: 24
    step: 0.5
    unit_of_measurement: "°C"

automation:
  - alias: Heating comfort mode
    triggers:
      - trigger: state
        entity_id: binary_sensor.someone_home
        to: "on"
    actions:
      - action: climate.set_temperature
        target:
          entity_id: climate.living_room
        data:
          temperature: "{{ states('input_number.comfort_temperature') | float }}"
`,
  'packages/garden.yaml': `# Garden irrigation
automation:
  - alias: Water the garden
    triggers:
      - trigger: time
        at: "06:30:00"
    conditions:
      - condition: numeric_state
        entity_id: sensor.garden_soil_moisture
        below 30
    actions:
      - action: switch.turn_on
        target:
          entity_id: switch.garden_valve
      - delay: "00:20:00"
      - action: switch.turn_off
        target:
          entity_id: switch.garden_valve
`,
  'packages/lighting.yaml': `light:
  - platform: group
    name: Ground floor
    entities:
      - light.living_room
      - light.kitchen
      - light.hallway
`,
  'themes/midnight.yaml': `midnight:
  primary-color: "#5b8def"
  accent-color: "#ffb74d"
`,
  'blueprints/automation/motion_light.yaml': `blueprint:
  name: Motion-activated light
  domain: automation
  input:
    motion_entity:
      name: Motion sensor
    light_target:
      name: Light
`,
  'custom_components/.keep': '',
  'www/.keep': '',
  '.storage/core.config': '{}\n',
};

const entities = [
  ['light.living_room', 'on', 'Living room light'],
  ['light.kitchen', 'off', 'Kitchen light'],
  ['light.hallway', 'off', 'Hallway light'],
  ['light.bedroom', 'off', 'Bedroom light'],
  ['light.garden', 'off', 'Garden light'],
  ['sensor.living_room_temperature', '21.4', 'Living room temperature', '°C'],
  ['sensor.bedroom_temperature', '19.8', 'Bedroom temperature', '°C'],
  ['sensor.garden_soil_moisture', '34', 'Garden soil moisture', '%'],
  ['binary_sensor.front_door', 'off', 'Front door'],
  ['binary_sensor.someone_home', 'on', 'Someone home'],
  ['climate.living_room', 'heat', 'Living room thermostat'],
  ['switch.garden_valve', 'off', 'Garden valve'],
  ['media_player.living_room_tv', 'off', 'Living room TV'],
  ['group.family', 'home', 'Family'],
  ['input_number.comfort_temperature', '21', 'Comfort temperature', '°C'],
].map(([entity_id, state, friendly_name, unit]) => ({
  entity_id,
  state,
  attributes: { friendly_name, ...(unit ? { unit_of_measurement: unit } : {}) },
}));

const services = [
  {
    domain: 'light',
    services: {
      turn_on: { name: 'Turn on', fields: { brightness_pct: { name: 'Brightness' }, transition: { name: 'Transition' } } },
      turn_off: { name: 'Turn off', fields: { transition: { name: 'Transition' } } },
      toggle: { name: 'Toggle', fields: {} },
    },
  },
  { domain: 'switch', services: { turn_on: { name: 'Turn on', fields: {} }, turn_off: { name: 'Turn off', fields: {} } } },
  { domain: 'climate', services: { set_temperature: { name: 'Set temperature', fields: { temperature: { name: 'Temperature' } } } } },
];

const root = await mkdtemp(path.join(os.tmpdir(), 'editha-shots-'));
const configDir = path.join(root, 'config');
const dataDir = path.join(root, 'data');
for (const [rel, content] of Object.entries(files)) {
  const abs = path.join(configDir, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content);
}
await mkdir(dataDir, { recursive: true });
await copyFile(path.resolve(here, '../../logo.png'), path.join(configDir, 'www/editha-logo.png'));
await mkdir(out, { recursive: true });

const HA_TOKEN = 'docs-token';
const fakeHa = http.createServer((req, res) => {
  const json = (data) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(data));
  if (req.headers.authorization !== `Bearer ${HA_TOKEN}`) return res.writeHead(401).end();
  if (req.url === '/api/states') return json(entities);
  if (req.url === '/api/services') return json(services);
  if (req.url === '/api/config/core/check_config') return json({ result: 'valid', errors: null });
  if (req.url?.startsWith('/api/services/')) return json([]);
  // Template preview: a plausible result for the sample template.
  if (req.method === 'POST' && req.url === '/api/template') {
    req.resume();
    return res.writeHead(200, { 'content-type': 'text/plain' }).end('21.4');
  }
  res.writeHead(404).end();
});
await new Promise((r) => fakeHa.listen(HA_PORT, '127.0.0.1', r));

const server = spawn(process.execPath, [path.join(here, '../../server/dist/main.js')], {
  stdio: 'inherit',
  env: {
    ...process.env,
    EDITHA_PORT: String(PORT),
    EDITHA_CONFIG_DIR: configDir,
    EDITHA_DATA_DIR: dataDir,
    EDITHA_WEB_DIR: path.join(here, '../dist'),
    EDITHA_HOST: '127.0.0.1',
    EDITHA_ALLOWED_IPS: '127.0.0.1,::1',
    EDITHA_LOG_LEVEL: 'warn',
    EDITHA_HA_URL: `http://127.0.0.1:${HA_PORT}/api`,
    EDITHA_HA_TOKEN: HA_TOKEN,
  },
});
for (let i = 0; ; i++) {
  const ok = await fetch(BASE + 'api/health').then((r) => r.ok, () => false);
  if (ok) break;
  if (i > 50) throw new Error('Editha did not start');
  await new Promise((r) => setTimeout(r, 200));
}

const browser = await chromium.launch();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function session(theme, { width = 1440, height = 860, scale = 2, tabs = [], active = null, mobile = false, outline = false } = {}) {
  // The previous page may still be saving its settings while it closes.
  await wait(800);
  await fetch(BASE + 'api/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ theme, language: 'en', sidebarVisible: !mobile, wordWrap: false, showSystem: false, outlineVisible: outline }),
  });
  await fetch(BASE + 'api/session', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tabs: tabs.map((p) => ({ path: p, anchor: 0, head: 0, scrollTop: 0 })), active }),
  });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme: theme === 'light' ? 'light' : 'dark',
  });
  const page = await context.newPage();
  await page.goto(BASE);
  await page.locator('editha-file-tree .row[data-path="configuration.yaml"]').waitFor({ state: 'attached' });
  await wait(600);
  return page;
}

const row = (page, p) => page.locator(`editha-file-tree .row[data-path="${p}"]`);
const tool = (page, title) => page.locator(`editha-toolbar button[title^="${title}"]`);
const editor = (page) => page.locator('editha-editor-pane .cm-content');
const shot = async (page, name, clip) => {
  // Messaggi di conferma: non nelle immagini.
  for (const b of await page.locator('editha-toasts button').all()) await b.click().catch(() => undefined);
  await wait(400);
  await page.screenshot({ path: path.join(out, `${name}.png`), clip });
  console.log('saved', name);
};
async function goToLine(page, line) {
  await editor(page).click();
  await page.keyboard.press('Control+Home');
  for (let i = 1; i < line; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
}

try {
  // Version history: two saved edits of automations.yaml (Editha keeps the previous version at each save).
  {
    const page = await session('dark', { tabs: ['automations.yaml'], active: 'automations.yaml' });
    await goToLine(page, 17);
    await page.keyboard.press('Control+Shift+ArrowLeft');
    await page.keyboard.type('80');
    await page.keyboard.press('Control+s');
    await wait(1200);
    await goToLine(page, 18);
    await page.keyboard.press('Control+Shift+ArrowLeft');
    await page.keyboard.type('3');
    await page.keyboard.press('Control+s');
    await wait(800);
    await page.context().close();
  }

  // 1. Main window, dark theme.
  {
    const page = await session('dark', {
      tabs: ['configuration.yaml', 'automations.yaml', 'packages/heating.yaml'],
      active: 'automations.yaml',
    });
    await row(page, 'packages').click();
    await wait(300);
    await goToLine(page, 14);
    await shot(page, 'main-dark');
    await page.context().close();
  }

  // 2. Main window, light theme, with !include and !secret links.
  {
    const page = await session('light', { tabs: ['configuration.yaml', 'automations.yaml'], active: 'configuration.yaml' });
    await goToLine(page, 18);
    await shot(page, 'main-light');
    await page.context().close();
  }

  // 3. YAML problems explained.
  {
    const page = await session('dark', { tabs: ['packages/garden.yaml'], active: 'packages/garden.yaml' });
    await row(page, 'packages').click();
    await page.locator('editha-status-bar button.problems').click();
    await wait(300);
    await goToLine(page, 10);
    await shot(page, 'problems');
    await page.context().close();
  }

  // 4. Entity autocompletion.
  {
    const page = await session('dark', { tabs: ['scripts.yaml'], active: 'scripts.yaml' });
    await goToLine(page, 12);
    await page.keyboard.insertText('\n    - action: light.turn_off\n      target:\n        entity_id: ');
    await page.keyboard.type('light.', { delay: 40 });
    await page.locator('.cm-tooltip-autocomplete').waitFor();
    await shot(page, 'autocomplete-entities');
    await page.context().close();
  }

  // 5. Material Design Icons with preview.
  {
    const page = await session('light', { tabs: ['scripts.yaml'], active: 'scripts.yaml' });
    await goToLine(page, 3);
    await page.keyboard.press('Shift+Home');
    await page.keyboard.type('icon: mdi:sofa', { delay: 40 });
    await page.locator('.cm-tooltip-autocomplete .cm-mdi-preview svg').first().waitFor();
    await shot(page, 'autocomplete-icons');
    await page.context().close();
  }

  // 6. Insert panel: entities.
  {
    const page = await session('dark', { tabs: ['automations.yaml'], active: 'automations.yaml' });
    await tool(page, 'Insert entity').click();
    await wait(800);
    await shot(page, 'insert-panel');
    await page.context().close();
  }

  // 7. Split view.
  {
    const page = await session('dark', { tabs: ['configuration.yaml', 'packages/heating.yaml'], active: 'configuration.yaml' });
    await tool(page, 'Split view').click();
    await wait(300);
    await page.locator('editha-app select').selectOption('packages/heating.yaml');
    await wait(500);
    await shot(page, 'split-view');
    await page.context().close();
  }

  // 8. Search in all files.
  {
    const page = await session('dark', { tabs: ['automations.yaml'], active: 'automations.yaml' });
    await page.locator('editha-file-tree button[title^="Search all files"]').click();
    const panel = page.locator('editha-search-panel');
    await panel.locator('button[title="Whole word"]').click();
    await panel.locator('.box input').fill('light.living_room');
    await panel.getByText(/results in/).waitFor();
    await wait(400);
    await shot(page, 'search');
    await page.context().close();
  }

  // 9. Version history with comparison.
  {
    const page = await session('dark', { tabs: ['automations.yaml'], active: 'automations.yaml' });
    await tool(page, 'File history').click();
    await page.locator('editha-history-panel .version').first().waitFor();
    await page.locator('editha-history-panel .version').nth(1).click();
    await wait(800);
    await shot(page, 'history');
    await page.context().close();
  }

  // 10. Home Assistant menu: check, reload, restart.
  {
    const page = await session('light', { tabs: ['configuration.yaml'], active: 'configuration.yaml' });
    await tool(page, 'Home Assistant:').click();
    await wait(300);
    await shot(page, 'ha-menu', { x: 0, y: 0, width: 1440, height: 420 });
    await page.keyboard.press('Escape');
    await page.context().close();
  }

  // 11. Phone: editor and file explorer.
  {
    const opts = { width: 390, height: 844, scale: 3, mobile: true, tabs: ['automations.yaml'], active: 'automations.yaml' };
    let page = await session('dark', opts);
    await shot(page, 'phone-editor');
    await page.context().close();
    page = await session('dark', opts);
    await tool(page, 'Show/hide').click();
    await wait(400);
    await shot(page, 'phone-tree');
    await page.context().close();
  }

  // 12. Image preview.
  {
    const page = await session('dark', { tabs: ['configuration.yaml'], active: 'configuration.yaml' });
    await row(page, 'www').click();
    await row(page, 'www/editha-logo.png').click();
    await page.locator('editha-preview-panel img').waitFor();
    await shot(page, 'preview');
    await page.context().close();
  }

  // 13. File outline.
  {
    const page = await session('dark', { tabs: ['configuration.yaml', 'automations.yaml'], active: 'automations.yaml', outline: true });
    await page.locator('editha-outline-panel button.item', { hasText: 'Door left open' }).click();
    await shot(page, 'outline');
    await page.context().close();
  }

  // 14. Jinja template preview (Alt+T on the "Average temperature" template).
  {
    const page = await session('dark', { tabs: ['configuration.yaml'], active: 'configuration.yaml' });
    await goToLine(page, 26);
    await page.keyboard.press('Alt+t');
    await page.locator('editha-template-panel .ok').waitFor();
    await shot(page, 'template-preview');
    await page.context().close();
  }

  // 15. Local Git: repository, first commit, then a modified file with the legend.
  {
    const page = await session('dark', { tabs: ['automations.yaml'], active: 'automations.yaml' });
    await page.locator('editha-file-tree button[data-action="git"]').click();
    const panel = page.locator('editha-git-panel');
    await panel.locator('button[data-action="git-init"]').click();
    await panel.locator('button[data-action="git-ignore"]').first().waitFor();
    // www/ only holds images: excluded with the crossed-out eye.
    await panel.locator('ul.changes li', { hasText: 'www/' }).locator('button[data-action="git-ignore"]').click();
    await wait(600);
    await panel.locator('textarea.message').fill('Initial configuration');
    await panel.locator('button[data-action="git-commit"]').click();
    await panel.locator('.card', { hasText: 'Initial configuration' }).waitFor();
    await goToLine(page, 17);
    await page.keyboard.press('Control+Shift+ArrowLeft');
    await page.keyboard.type('75');
    await page.keyboard.press('Control+s');
    await panel.locator('ul.changes li', { hasText: 'automations.yaml' }).waitFor();
    await panel.locator('textarea.message').fill('Sunset lights: higher brightness');
    await shot(page, 'git-panel');
    await page.context().close();
  }

  // 16. Cover image: desktop window and phone side by side.
  {
    const img = async (name) => `data:image/png;base64,${(await readFile(path.join(out, `${name}.png`))).toString('base64')}`;
    const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 })).newPage();
    await page.setContent(`<!doctype html><html><head><style>
      * { box-sizing: border-box; }
      body { margin: 0; width: 1600px; height: 900px; overflow: hidden; font-family: Inter, system-ui, sans-serif;
        background: radial-gradient(circle at 15% 10%, #3b5bdb 0, transparent 45%),
          radial-gradient(circle at 90% 90%, #6a5cff 0, transparent 40%), #0f1422; color: #fff; }
      .title { position: absolute; left: 72px; top: 64px; }
      .title .row { display: flex; align-items: center; gap: 18px; }
      .logo { width: 64px; height: 64px; border-radius: 16px; display: grid; place-items: center; font-size: 36px; font-weight: 700;
        background: linear-gradient(135deg, #2f7cf6, #6a5cff); box-shadow: 0 8px 24px rgba(0,0,0,.35); }
      h1 { margin: 0; font-size: 52px; letter-spacing: .03em; }
      p { margin: 14px 0 0; font-size: 22px; color: #c9d3ee; }
      .window { position: absolute; left: 72px; top: 205px; width: 1060px; border-radius: 14px; overflow: hidden;
        background: #1b1f27; box-shadow: 0 30px 80px rgba(0,0,0,.55); border: 1px solid rgba(255,255,255,.08); }
      .bar { height: 34px; display: flex; align-items: center; gap: 8px; padding: 0 14px; background: #262b35; }
      .bar i { width: 12px; height: 12px; border-radius: 50%; display: block; }
      .window img { display: block; width: 100%; }
      .phone { position: absolute; right: 150px; top: 120px; width: 316px; border-radius: 46px; padding: 12px; background: #05070c;
        box-shadow: 0 30px 80px rgba(0,0,0,.6); border: 1px solid rgba(255,255,255,.12); }
      .phone img { display: block; width: 100%; border-radius: 36px; }
    </style></head><body>
      <div class="title"><div class="row"><div class="logo">E</div><h1>EDITHA</h1></div>
        <p>Every Day I Tweak HA · smart file editor for Home Assistant</p></div>
      <div class="window"><div class="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
        <img src="${await img('main-dark')}"></div>
      <div class="phone"><img src="${await img('phone-editor')}"></div>
    </body></html>`);
    await wait(300);
    await page.screenshot({ path: path.join(out, 'cover.png') });
    console.log('saved cover');
  }
} finally {
  await browser.close();
  server.kill();
  fakeHa.close();
  await rm(root, { recursive: true, force: true });
}
