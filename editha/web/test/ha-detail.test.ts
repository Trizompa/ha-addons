import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detailContext, detailOptions, entityDetails, insertText, panelContext, type DetailEntity } from '../src/editor/ha-detail.js';

/** Contesto con il cursore dove c'è «|» nel testo (`panel`: quello del pannello Inserisci). */
function at(text: string, panel = false) {
  const pos = text.indexOf('|');
  const doc = text.slice(0, pos) + text.slice(pos + 1);
  const lines = doc.split('\n');
  const index = doc.slice(0, pos).split('\n').length - 1;
  const before = lines[index]!.slice(0, pos - doc.lastIndexOf('\n', pos - 1) - 1);
  return (panel ? panelContext : detailContext)(lines, index, before);
}

const yamlCtx = { typed: 0, quote: '', template: false, key: null } as const;

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
    assert.deepEqual(above, { ...yamlCtx, kind: 'attribute', entities: ['climate.salotto'], typed: 2, key: 'attribute' });
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
    assert.deepEqual(trigger, { ...yamlCtx, kind: 'state', entities: ['climate.salotto'], key: 'to' });
    assert.deepEqual(detailOptions(trigger!, ENTITIES).map((o) => o.label), ['heat', 'off', 'cool', 'unavailable', 'unknown']);
    assert.equal(detailOptions(trigger!, ENTITIES)[0]!.current, true);
    const list = at('- condition: state\n  entity_id: input_select.modo\n  state:\n    - Casa\n    - F|\n');
    assert.deepEqual(list, { ...yamlCtx, kind: 'state', entities: ['input_select.modo'], typed: 1, key: 'state' });
    const inline = at('- condition: state\n  entity_id: light.cucina, light.studio\n  state: "|\n');
    assert.deepEqual(inline?.entities, ['light.cucina', 'light.studio']);
    assert.equal(inline?.quote, '"');
  });

  it('con attribute: nel blocco, state: è il valore dell\'attributo: niente suggerimenti', () => {
    assert.equal(at('- condition: state\n  entity_id: climate.salotto\n  attribute: hvac_action\n  state: |\n'), null);
  });

  it('template: state_attr, is_state_attr, states.x.attributes, is_state', () => {
    assert.deepEqual(at('value_template: "{{ state_attr(\'climate.salotto\', \'cur|\') }}"'), {
      kind: 'attribute',
      entities: ['climate.salotto'],
      typed: 3,
      quote: "'",
      template: true,
      key: null,
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
    assert.equal(insertText({ ...ctx, quote: '"' }, 'on'), 'on');
    // Entità che HA non conosce, di un dominio senza stati tipici: niente da proporre.
    assert.deepEqual(detailOptions(at('- entity_id: sensor.nuovo\n  to: |\n')!, ENTITIES), []);
  });

  it('altre chiavi e righe senza entità: niente', () => {
    assert.equal(at('- entity_id: light.cucina\n  name: |\n'), null);
    assert.equal(at('to: |\n'), null);
    assert.equal(at('# entity_id: light.cucina\n'), null);
  });

  it('virgolette quando lo YAML leggerebbe il valore in un altro modo', () => {
    const ctx = at('- entity_id: input_select.modo\n  state: |\n')!;
    for (const [label, out] of [
      ['Casa', 'Casa'],
      ['Fuori casa', 'Fuori casa'],
      ['Fuori: casa', '"Fuori: casa"'],
      ['#1', '"#1"'],
      ['01', '"01"'],
      ['1:30', '"1:30"'],
      ['null', '"null"'],
      ['*stella', '"*stella"'],
      ['- x', '"- x"'],
      ["l'ingresso", '"l\'ingresso"'],
    ]) {
      assert.equal(insertText(ctx, label!), out, label);
    }
    // Virgolette già aperte: si protegge solo la virgoletta dentro il testo.
    assert.equal(insertText({ ...ctx, quote: "'" }, "l'ingresso"), "l''ingresso");
    assert.equal(insertText({ ...ctx, quote: '"' }, 'a "b"'), 'a \\"b\\"');
    // Gli attributi sono nomi: mai virgolette.
    assert.equal(insertText({ ...ctx, kind: 'attribute' }, 'on'), 'on');
  });

  it('valori con spazi: i suggerimenti restano anche dopo lo spazio', () => {
    const ctx = at('- entity_id: input_select.modo\n  state: "Fuori c|"\n');
    assert.equal(ctx?.typed, 'Fuori c'.length);
  });

  it('pannello: l\'entità del blocco dove sta il cursore, anche fuori da state: e attribute:', () => {
    const text = '- trigger: state\n  entity_id: climate.salotto\n  for: "00:05:00"|\n- trigger: time\n  at: "07:00"\n';
    assert.deepEqual(at(text, true), { ...yamlCtx, kind: null, entities: ['climate.salotto'] });
    // Sulla riga «entity_id:» stessa.
    assert.deepEqual(at('- trigger: state\n  entity_id: light.cucina|\n', true)?.entities, ['light.cucina']);
    // Su una riga vuota dentro il blocco.
    assert.deepEqual(at('- condition: state\n  entity_id: light.cucina\n  |\n', true)?.entities, ['light.cucina']);
    // Nel blocco successivo, senza entità: niente.
    assert.equal(at('- trigger: state\n  entity_id: light.cucina\n- trigger: time\n  at: |\n', true), null);
    // Dopo «to:» è lo stesso contesto dei suggerimenti.
    assert.equal(at('- entity_id: light.cucina\n  to: |\n', true)?.kind, 'state');
  });

  it('dettagli per il riquadro: stati (prima l\'attuale) e attributi', () => {
    const d = entityDetails(['climate.salotto'], ENTITIES);
    assert.deepEqual(d.states.map((s) => s.label), ['heat', 'off', 'cool', 'unavailable', 'unknown']);
    assert.deepEqual(d.attributes, ['hvac_modes', 'current_temperature', 'hvac_action']);
    assert.deepEqual(entityDetails(['sensor.nuovo'], ENTITIES), { states: [], attributes: [] });
  });
});
