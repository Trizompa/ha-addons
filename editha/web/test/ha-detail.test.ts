import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detailContext, detailOptions, insertText, type DetailEntity } from '../src/editor/ha-detail.js';

/** Contesto con il cursore dove c'è «|» nel testo. */
function at(text: string) {
  const pos = text.indexOf('|');
  const doc = text.slice(0, pos) + text.slice(pos + 1);
  const lines = doc.split('\n');
  const index = doc.slice(0, pos).split('\n').length - 1;
  const before = lines[index]!.slice(0, pos - doc.lastIndexOf('\n', pos - 1) - 1);
  return detailContext(lines, index, before);
}

const entity = (entity_id: string, state: string, attributes: string[] = [], states: string[] = []): DetailEntity => ({
  entity_id,
  state,
  attributes,
  states,
});

const ENTITIES = [
  entity('climate.salotto', 'heat', ['hvac_modes', 'current_temperature', 'hvac_action'], ['off', 'heat', 'cool']),
  entity('light.cucina', 'on', ['brightness', 'friendly_name']),
  entity('input_select.modo', 'Casa', ['options'], ['Casa', 'Fuori']),
];

describe('attributi e stati nei suggerimenti (HA-12)', () => {
  it('attribute: con entity_id nello stesso blocco, sopra o sotto', () => {
    const above = at('condition:\n  - condition: state\n    entity_id: climate.salotto\n    attribute: hv|\n');
    assert.deepEqual(above, { kind: 'attribute', entities: ['climate.salotto'], typed: 2, quoted: false });
    const below = at('- condition: state\n  attribute: |\n  entity_id: climate.salotto\n');
    assert.deepEqual(below?.entities, ['climate.salotto']);
    assert.deepEqual(detailOptions(above!, ENTITIES).map((o) => o.label), ['hvac_modes', 'current_temperature', 'hvac_action']);
  });

  it('non prende l\'entità di un altro elemento dell\'elenco', () => {
    const text = '- condition: state\n  entity_id: light.cucina\n  state: "on"\n- condition: state\n  state: |\n';
    assert.equal(at(text), null);
    const next = '- condition: state\n  state: |\n- condition: state\n  entity_id: light.cucina\n';
    assert.equal(at(next), null);
  });

  it('state:, to:, elenchi di entità e di stati', () => {
    const trigger = at('trigger:\n  - trigger: state\n    entity_id:\n      - climate.salotto\n    to: |\n');
    assert.deepEqual(trigger, { kind: 'state', entities: ['climate.salotto'], typed: 0, quoted: false });
    assert.deepEqual(detailOptions(trigger!, ENTITIES).map((o) => o.label), ['heat', 'off', 'cool', 'unavailable', 'unknown']);
    assert.equal(detailOptions(trigger!, ENTITIES)[0]!.current, true);
    const list = at('- condition: state\n  entity_id: input_select.modo\n  state:\n    - Casa\n    - F|\n');
    assert.deepEqual(list, { kind: 'state', entities: ['input_select.modo'], typed: 1, quoted: false });
    const inline = at('- condition: state\n  entity_id: light.cucina, light.studio\n  state: "|\n');
    assert.deepEqual(inline?.entities, ['light.cucina', 'light.studio']);
    assert.equal(inline?.quoted, true);
  });

  it('con attribute: nel blocco, state: è il valore dell\'attributo: niente suggerimenti', () => {
    assert.equal(at('- condition: state\n  entity_id: climate.salotto\n  attribute: hvac_action\n  state: |\n'), null);
  });

  it('template: state_attr, is_state_attr, states.x.attributes, is_state', () => {
    assert.deepEqual(at('value_template: "{{ state_attr(\'climate.salotto\', \'cur|\') }}"'), {
      kind: 'attribute',
      entities: ['climate.salotto'],
      typed: 3,
      quoted: true,
    });
    assert.equal(at('t: "{{ states.light.cucina.attributes.bri| }}"')?.kind, 'attribute');
    assert.deepEqual(at('t: "{{ is_state(\'light.cucina\', \'|\') }}"')?.entities, ['light.cucina']);
    assert.equal(at('t: "{{ is_state_attr(\'light.cucina\', \'|\') }}"')?.kind, 'attribute');
  });

  it('stati tipici del dominio, e «on» tra virgolette solo se serve', () => {
    const ctx = at('- entity_id: light.cucina\n  to: |\n')!;
    assert.deepEqual(detailOptions(ctx, ENTITIES).map((o) => o.label), ['on', 'off', 'unavailable', 'unknown']);
    assert.equal(insertText(ctx, 'on'), '"on"');
    assert.equal(insertText(ctx, 'heat'), 'heat');
    assert.equal(insertText({ ...ctx, quoted: true }, 'on'), 'on');
    // Entità che HA non conosce, di un dominio senza stati tipici: niente da proporre.
    assert.deepEqual(detailOptions(at('- entity_id: sensor.nuovo\n  to: |\n')!, ENTITIES), []);
  });

  it('altre chiavi e righe senza entità: niente', () => {
    assert.equal(at('- entity_id: light.cucina\n  name: |\n'), null);
    assert.equal(at('to: |\n'), null);
    assert.equal(at('# entity_id: light.cucina\n'), null);
  });
});
