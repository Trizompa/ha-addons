import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { activeOutlineIndex, buildOutline } from '../src/editor/outline.js';

describe('schema del file (ED-18)', () => {
  it('automations.yaml: una voce per automazione, con alias e riga', () => {
    const text = [
      '- id: "1"',
      '  alias: Luci al tramonto',
      '  triggers: []',
      '',
      '- id: buonanotte',
      '  alias: Buonanotte',
      '- id: "3"',
      '  triggers: []',
      '',
    ].join('\n');
    assert.deepEqual(buildOutline(text), [
      { label: 'Luci al tramonto', line: 1, depth: 0 },
      { label: 'Buonanotte', line: 5, depth: 0 },
      { label: '3', line: 7, depth: 0 },
    ]);
  });

  it('scripts.yaml: la voce è l\'alias, con la chiave accanto', () => {
    const text = 'film:\n  alias: Serata film\n  sequence: []\nnotte:\n  sequence: []\n';
    assert.deepEqual(buildOutline(text), [
      { label: 'Serata film', detail: 'film', line: 1, depth: 0 },
      { label: 'notte', line: 4, depth: 0 },
    ]);
  });

  it('configuration.yaml e package: sezioni, e dentro liste e oggetti con nome', () => {
    const text = [
      'homeassistant:',
      '  name: Casa',
      '  packages: !include_dir_named packages',
      'automation: !include automations.yaml',
      'sensor:',
      '  - platform: template',
      '    sensors: {}',
      'automation pacchetto:',
      '  - alias: Irriga',
      '    triggers: []',
      'input_number:',
      '  comfort:',
      '    name: Comfort',
      '  minimo:',
      '    min: 1',
      '',
    ].join('\n');
    assert.deepEqual(buildOutline(text), [
      { label: 'homeassistant', line: 1, depth: 0 },
      { label: 'automation', line: 4, depth: 0 },
      { label: 'sensor', line: 5, depth: 0 },
      { label: 'platform: template', line: 6, depth: 1 },
      { label: 'automation pacchetto', line: 8, depth: 0 },
      { label: 'Irriga', line: 9, depth: 1 },
      { label: 'input_number', line: 11, depth: 0 },
      { label: 'Comfort', detail: 'comfort', line: 12, depth: 1 },
      { label: 'minimo', line: 14, depth: 1 },
    ]);
  });

  it('regge file con errori, vuoti o che non sono mappe né liste', () => {
    assert.deepEqual(buildOutline(''), []);
    assert.deepEqual(buildOutline('solo testo\n'), []);
    const broken = buildOutline('a: 1\nb:\n  - alias: Uno\n   c: x\n');
    assert.equal(broken[0]?.label, 'a');
  });

  it('voce attiva: l\'ultima che inizia prima del cursore', () => {
    const items = buildOutline('a: 1\nb: 2\nc: 3\n');
    assert.equal(activeOutlineIndex(items, 1), 0);
    assert.equal(activeOutlineIndex(items, 2), 1);
    assert.equal(activeOutlineIndex(items, 9), 2);
    assert.equal(activeOutlineIndex([], 3), -1);
  });
});
