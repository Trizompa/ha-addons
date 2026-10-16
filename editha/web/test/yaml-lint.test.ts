import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lintYaml, visibleRange } from '../src/editor/yaml-lint.js';
import { languageOf } from '../src/editor/languages.js';
import { validateName, rebase, isWithin, dirname, basename, resolvePath } from '../src/state/paths.js';
import { linksIn } from '../src/editor/links.js';

describe('lintYaml (HA-1)', () => {
  it('lo stesso errore in due punti sono due errori', () => {
    const dup = lintYaml('automation:\n  - alias: a\n    mode: single\n    mode: queued\n  - alias: b\n    mode: single\n    mode: restart\n');
    assert.equal(dup.length, 2, JSON.stringify(dup));
    assert.equal(lintYaml('a: @x\nb: 1\nc: @y\n').filter((p) => p.severity === 'error').length, 2);
  });

  it('template Jinja senza virgolette e alias senza ancora', () => {
    const tpl = lintYaml('value_template: {{ states("x") }}\n');
    assert.equal(tpl.length, 1);
    assert.match(tpl[0]!.message, /template va tra virgolette/);
    assert.equal(lintYaml('a:\n  - {{ x }}\n')[0]?.severity, 'error');
    assert.deepEqual(lintYaml('value_template: "{{ states(\'x\') }}"\n'), []);
    assert.match(lintYaml('a: *nope\n')[0]?.message ?? '', /«\*nope» rimanda/);
    assert.equal(lintYaml('a: *x\nb: &x 1\n').length, 1);
    assert.deepEqual(lintYaml('base: &b\n  x: 1\nuso:\n  <<: *b\n  y: 2\n'), []);
  });

  it('accetta una configurazione corretta con i tag di HA', () => {
    const text = [
      'homeassistant:',
      '  name: Casa',
      '  packages: !include_dir_named packages',
      'automation: !include automations.yaml',
      'api_password: !secret http_password',
      'sensor:',
      '  - platform: template',
      '    sensors:',
      '      t:',
      '        value_template: "{{ states(\'sensor.x\') }}"',
      'input: !input motion_entity',
      'token: !env_var TOKEN',
      '',
    ].join('\n');
    assert.deepEqual(lintYaml(text), []);
  });

  it('segnala l\'errore nel punto esatto', () => {
    const text = 'light:\n  - platform: x\n   name: storto\n';
    const problems = lintYaml(text);
    assert.ok(problems.length > 0);
    const first = problems[0]!;
    assert.equal(first.severity, 'error');
    // L'errore cade sulla terza riga, non all'inizio del file.
    assert.ok(first.from >= text.indexOf('   name'), `from=${first.from}`);
  });

  it('segnala le tabulazioni usate per indentare', () => {
    const problems = lintYaml('a:\n\tb: 1\n');
    assert.ok(problems.some((p) => p.severity === 'error'));
  });

  it('spiega gli errori di indentazione con le righe coinvolte', () => {
    const item = lintYaml('light:\n  - platform: x\n   name: storto\n');
    assert.match(item[0]!.message, /riga 3 rientra di 3 spazi.*riga 2 deve rientrare di 4 spazi/);
    const deeper = lintYaml('sensor:\n  name: a\n    unit: b\n');
    assert.equal(deeper.length, 1);
    assert.match(deeper[0]!.message, /La riga 2 ha già un valore \(«name: a»\), quindi non può contenere la riga 3/);
    const colon = lintYaml('input_number:\n  car:\n    name: a\n  porcodio\n    name: "Pippo"\n');
    assert.equal(colon.length, 1);
    assert.match(colon[0]!.message, /Alla riga 4 mancano i due punti dopo «porcodio»/);
    // Le righe giuste sotto la chiave senza «:» non vengono segnalate come errori a cascata.
    const cascade = lintYaml(
      'input_number:\n  a:\n    min: 0\n\n  porcodio\n    name: "P"\n    min: 0\n    max: 9\n    step: 1\n\ntemplate:\n  - sensor: []\n',
    );
    assert.equal(cascade.length, 1, JSON.stringify(cascade));
    const level = lintYaml('automation:\n  - alias: a\n    trigger:\n      - platform: state\n   action: []\n');
    assert.match(level[0]!.message, /livelli possibili: 0, 2, 4, 6, 8/);
    const inline = lintYaml(
      'automation:\n  - alias: a\n    conditions:\n      - condition: numeric_state\n        entity_id: sensor.x\n        below 30\n    actions: []\n',
    );
    assert.equal(inline.length, 1, JSON.stringify(inline));
    assert.match(inline[0]!.message, /Alla riga 6 mancano i due punti dopo «below»: probabilmente deve essere «below: 30»/);
    const space = lintYaml('homeassistant:\n  name:Casa\n  unit_system: metric\n');
    assert.match(space[0]!.message, /Scrivi «name: Casa»/);
  });

  it('avvisa degli errori tipici di HA che restano YAML valido', () => {
    const bool = lintYaml('trigger:\n  - platform: state\n    to: on\n');
    assert.equal(bool.length, 1);
    assert.equal(bool[0]!.severity, 'warning');
    assert.match(bool[0]!.message, /«on» senza virgolette/);
    const text = lintYaml('sensor:\n  - platform:template\n');
    assert.match(text[0]!.message, /Scrivi «platform: template»/);
    const odd = lintYaml('a:\n  b: 1\n  c: 2\n  d:\n     e: 3\n  f: 4\n');
    assert.deepEqual(odd.map((p) => p.severity), ['warning']);
    assert.match(odd[0]!.message, /Rientro di 5 spazi/);
  });

  it('non segnala testi liberi, orari, icone, URL e valori tra virgolette', () => {
    const text = [
      'a:',
      '  b: |',
      '     testo',
      '       libero',
      '  to: "on"',
      '  icon: mdi:home',
      '  at: 07:00:00',
      '  url: http://x',
      '  lista:',
      '  - uno',
      '  - due',
      '',
    ].join('\n');
    assert.deepEqual(lintYaml(text), []);
  });

  it('tratta le chiavi duplicate come avviso', () => {
    const problems = lintYaml('a: 1\na: 2\n');
    assert.equal(problems.length, 1);
    assert.equal(problems[0]!.severity, 'warning');
    assert.match(problems[0]!.message, /Chiave «a» ripetuta/);
  });

  it('valida tutti i documenti di un file multi-documento', () => {
    assert.ok(lintYaml('a: 1\n---\nb: [1, 2\n').length > 0);
  });

  it('sposta le segnalazioni vuote sul testo più vicino', () => {
    const text = 'a: 1\n\n  b: [1, 2\n';
    assert.deepEqual(visibleRange(text, 5, 5), [8, 16]);
    assert.deepEqual(visibleRange(text, text.length, text.length), [8, 16]);
    assert.deepEqual(visibleRange(text, 0, 1), [0, 1]);
    for (const p of lintYaml(text)) assert.notEqual(text.slice(p.from, p.to).trim(), '');
  });

  it('non segnala nulla per un file vuoto o di soli commenti', () => {
    assert.deepEqual(lintYaml(''), []);
    assert.deepEqual(lintYaml('# solo un commento\n'), []);
  });
});

describe('languageOf (ED-2)', () => {
  it('riconosce i linguaggi dall\'estensione', () => {
    assert.equal(languageOf('configuration.yaml').id, 'yaml');
    assert.equal(languageOf('x/scripts.YML').id, 'yaml');
    assert.equal(languageOf('python_scripts/a.py').id, 'python');
    assert.equal(languageOf('www/card.js').id, 'javascript');
    assert.equal(languageOf('custom_templates/t.jinja').id, 'jinja');
    assert.equal(languageOf('README.md').id, 'markdown');
    assert.equal(languageOf('.HA_VERSION').id, 'text');
    assert.equal(languageOf('Makefile').id, 'text');
  });
});

describe('percorsi', () => {
  it('valida i nomi', () => {
    assert.equal(validateName('scene.yaml'), null);
    assert.notEqual(validateName(''), null);
    assert.notEqual(validateName('..'), null);
    assert.notEqual(validateName('a/b'), null);
  });

  it('calcola cartelle e nomi', () => {
    assert.equal(dirname('a/b/c.yaml'), 'a/b');
    assert.equal(dirname('c.yaml'), '');
    assert.equal(basename('a/b/c.yaml'), 'c.yaml');
    assert.equal(rebase('a/b/c', 'a/b', 'x'), 'x/c');
    assert.ok(isWithin('a/b', 'a'));
    assert.ok(!isWithin('ab', 'a'));
  });
});

describe('collegamenti !include / !secret (HA-4, HA-5)', () => {
  it('trova i bersagli nella riga, anche tra virgolette', () => {
    assert.deepEqual(
      linksIn('automation: !include automations.yaml # commento').map((l) => [l.kind, l.target]),
      [['include', 'automations.yaml']],
    );
    assert.deepEqual(linksIn('sensor: !include_dir_merge_list "sensori"').map((l) => [l.kind, l.target]), [['dir', 'sensori']]);
    // Elenchi e mappe { } su una riga, testi tra virgolette e # dentro le virgolette.
    assert.deepEqual(linksIn('a: [!include a.yaml, !include b.yaml]').map((l) => l.target), ['a.yaml', 'b.yaml']);
    assert.deepEqual(linksIn('a: {x: !include a.yaml}').map((l) => l.target), ['a.yaml']);
    assert.deepEqual(linksIn('c: "!include non_e_un_tag.yaml"'), []);
    assert.deepEqual(linksIn('a: "x #y" !include x.yaml').map((l) => l.target), ['x.yaml']);
    assert.equal(resolvePath('a', '/config'), '');
    assert.equal(resolvePath('a/b', '../..'), '');
    const line = '  password: !secret wifi_pw';
    const [secret] = linksIn(line);
    assert.equal(secret?.kind, 'secret');
    assert.equal(line.slice(secret!.from, secret!.to), 'wifi_pw');
    assert.deepEqual(linksIn('name: Casa'), []);
  });

  it('risolve i percorsi relativi come HA, senza uscire da /config', () => {
    assert.equal(resolvePath('packages', 'luci.yaml'), 'packages/luci.yaml');
    assert.equal(resolvePath('packages/sub', '../altro/x.yaml'), 'packages/altro/x.yaml');
    assert.equal(resolvePath('', './a.yaml'), 'a.yaml');
    assert.equal(resolvePath('', '../fuori.yaml'), null);
  });
});

describe('correzioni della revisione (HA-9)', () => {
  it('ancore e tag aprono un blocco: le spiegazioni non incolpano righe giuste', () => {
    const problems = lintYaml('base: &base\n  a: 1\n  b\n  c: 2\n');
    assert.ok(problems.every((p) => !/«base: &base»/.test(p.message)), JSON.stringify(problems));
    assert.deepEqual(lintYaml('x: !!map\n  a: 1\ny: |2\n    testo\n'), []);
  });

  it('niente avvisi su <<: ripetuti, valori con tag, icone in elenco e collezioni [ ] su più righe', () => {
    assert.deepEqual(lintYaml('a: &a {x: 1}\nb: &b {y: 2}\nc:\n  <<: *a\n  <<: *b\n'), []);
    assert.deepEqual(lintYaml('c: !secret on\nd: !input yes\n'), []);
    assert.deepEqual(lintYaml('icons:\n  - mdi:home\n  - mdi:lightbulb\n'), []);
    assert.deepEqual(lintYaml('a:\n  b: [1,\n      2,\n   3]\n  c: 1\n  d: 2\n  e: 3\n'), []);
  });

  it('le chiavi ripetute hanno il nome giusto', () => {
    assert.match(lintYaml('"x:y": 3\n"x:y": 4\n')[0]!.message, /«x:y»/);
    assert.match(lintYaml('data: {a: 1, a: 2}\n')[0]!.message, /«a»/);
  });

  it('percorsi assoluti e commenti nei collegamenti', () => {
    assert.equal(resolvePath('packages', '/config/secrets.yaml'), 'secrets.yaml');
    assert.equal(resolvePath('packages', '/share/x.yaml'), null);
    assert.deepEqual(linksIn('# automation: !include vecchio.yaml'), []);
    assert.equal(linksIn('a: !include b.yaml # !include c.yaml').length, 1);
  });

  it('i nomi lunghi si misurano in byte', () => {
    assert.ok(validateName('é'.repeat(200)));
    assert.equal(validateName('e'.repeat(200)), null);
  });
});
