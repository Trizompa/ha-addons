import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isEsphomePath, lintYaml, LINT_MAX_CHARS } from '../src/editor/yaml-lint.js';
import { buildOutline, OUTLINE_MAX_CHARS, type Outline } from '../src/editor/outline.js';
import { normalizeSnippetBody } from '../src/editor/snippets.js';
import { linksIn } from '../src/editor/links.js';
import { setLang } from '../src/i18n/index.js';

setLang('it');

const errors = (text: string, path = '') => lintYaml(text, path).filter((p) => p.severity === 'error');
const warnings = (text: string, path = '') => lintYaml(text, path).filter((p) => p.severity === 'warning');

describe('lintYaml: spazi speciali e tabulazioni', () => {
  it('spazio non separabile nel rientro o dopo «:» e «-»: errore spiegato', () => {
    const lead = errors('homeassistant:\n\u00a0\u00a0name: Casa\n');
    assert.equal(lead.length, 1);
    assert.match(lead[0]!.message, /Carattere invisibile alla riga 2.*U\+00A0/);
    assert.equal(lead[0]!.from, 15);
    assert.equal(errors('a:\n  b:\u00a01\n').length, 1);
    assert.equal(errors('a:\n  -\u00a0x\n').length, 1);
    assert.equal(errors('a:\n  - \u2003x\n').length, 1);
    assert.equal(errors('a: 1\n\u3000\n').length, 1);
    // Il BOM all'inizio del file è normale; più avanti no.
    assert.deepEqual(lintYaml('\ufeffa: 1\n'), []);
    assert.equal(errors('a: 1\n\ufeffb: 2\n').length, 1);
    // Dentro un testo lo spazio speciale non conta.
    assert.deepEqual(lintYaml('a: "x\u00a0y"\nb: x\u00a0y\n'), []);
  });

  it('tabulazioni nel rientro, anche in righe vuote e commenti, e dopo «: »', () => {
    assert.match(errors('a:\n  b: 1\n\t# commento\n  c: 2\n')[0]?.message ?? '', /Tabulazione usata per indentare la riga 3/);
    assert.equal(errors('a:\n  b: 1\n\t\n  c: 2\n').length, 1);
    assert.match(errors('a:\n  b:\t1\n')[0]?.message ?? '', /Tabulazione dopo/);
    // Una sola spiegazione per riga, non anche quella della libreria.
    assert.equal(errors('a:\n\tb: 1\n').length, 1);
    // Dopo il valore, prima di un commento, va bene.
    assert.deepEqual(lintYaml('a: 1\t# x\n'), []);
  });

  it('JSON incollato con tabulazioni dentro { } e [ ], e testi tra virgolette: nessun errore', () => {
    assert.deepEqual(lintYaml('a: {\n\t"a": 1,\n\t"b": [\n\t\t1\n\t]\n}\n'), []);
    assert.deepEqual(lintYaml('{\n\t"a": 1\n}\n'), []);
    assert.deepEqual(lintYaml('a: "x\n\ty"\n'), []);
    // Nei blocchi | il rientro è del testo.
    assert.deepEqual(lintYaml('a: |\n  {% if x %}\n  \tfoo\n  {% endif %}\nb: 1\n'), []);
  });
});

describe('lintYaml: errori tipici spiegati', () => {
  it('apostrofo dentro apici singoli', () => {
    const p = errors("a:\n  message: 'L'allarme è attivo'\n");
    assert.equal(p.length, 1);
    assert.match(p[0]!.message, /riga 2.*'L''allarme è attivo'.*"L'allarme è attivo"/);
  });

  it('«: » dentro un valore senza virgolette', () => {
    const p = errors('notify:\n  message: Attenzione: porta aperta\n');
    assert.equal(p.length, 1);
    assert.match(p[0]!.message, /message: "Attenzione: porta aperta"/);
  });

  it('escape non valido tra virgolette doppie e template {% senza virgolette', () => {
    assert.match(errors('a: "\\d+"\n')[0]?.message ?? '', /«\\d» non valida/);
    const jinja = errors('a:\n  value_template: {% if x %}1{% endif %}\n');
    assert.equal(jinja.length, 1);
    assert.match(jinja[0]!.message, /inizia con «\{%»/);
  });

  it('codici della libreria tradotti', () => {
    assert.match(errors('a: &x &y 1\n')[0]?.message ?? '', /una sola ancora/);
    assert.ok(errors('a: [ - x ]\n').some((p) => /non può stare dentro \[ \] o \{ \}/.test(p.message)));
  });

  it('livelli possibili: le righe dei blocchi | non contano', () => {
    const p = errors('a:\n  b: |\n      testo\n      altro\n c: 1\n');
    assert.match(p[0]?.message ?? '', /livelli possibili: 0, 2\)/);
  });
});

describe('lintYaml: chiavi, tag, limiti', () => {
  it('chiave ripetuta con una cifra nel nome: segnalata in ogni blocco', () => {
    const dup = warnings('a:\n  light_1: x\n  light_1: y\nb:\n  light_1: x\n  light_1: y\n');
    assert.equal(dup.length, 2);
  });

  it('tag sconosciuto: errore con suggerimento; in esphome/ i tag di ESPHome vanno bene', () => {
    const tag = errors('a: !secrets x\n');
    assert.equal(tag.length, 1);
    assert.match(tag[0]!.message, /Tag sconosciuto !secrets: forse intendevi !secret\?/);
    assert.doesNotMatch(errors('a: !pippo x\n')[0]?.message ?? '', /forse/);
    const esphome = 'esphome/cucina.yaml';
    assert.deepEqual(lintYaml('a: !lambda return 1;\nb: !include {file: x.yaml, vars: {n: 1}}\nc: !extend x\nd: !remove x\ne: !secret wifi\n', esphome), []);
    assert.equal(errors('a: !lambda return 1;\n').length, 1);
    assert.ok(isEsphomePath('esphome/a.yaml'));
    assert.ok(isEsphomePath('pacchetti/esphome/a.yaml'));
    assert.ok(!isEsphomePath('esphome.yaml'));
  });

  it('manca lo spazio dopo «:» anche fuori dagli elenchi e su più righe', () => {
    const msg = (text: string) => warnings(text).map((p) => text.slice(p.from, p.to));
    assert.deepEqual(msg('logger:\n  default:info\n'), ['default:info']);
    assert.deepEqual(msg('homeassistant:\n  name:Casa\n'), ['name:Casa']);
    assert.deepEqual(msg('light:\n  - platform:hue\n    host:192.168.1.2\n'), ['platform:hue', 'host:192.168.1.2']);
    // Nessun falso allarme.
    assert.deepEqual(
      lintYaml('a:\n  url: http://x:8123\n  at: 12:30\n  mac: aa:bb:cc:dd:ee:ff\n  ip: fe80::1\n  entity_id: sensor.x\n  icon: mdi:home\n  name: platform:hue\n  host:\n    http://x\nb:\n  - mdi:home\n'),
      [],
    );
  });

  it('limiti: file enormi non controllati, al massimo 200 problemi in tutto', () => {
    assert.deepEqual(lintYaml('a: [\n'.repeat(Math.ceil(LINT_MAX_CHARS / 5) + 1)), []);
    const many = Array.from({ length: 300 }, (_v, i) => `k${i}: on`).join('\n');
    assert.equal(lintYaml(many).length, 200);
  });
});

describe('schema: script e limiti', () => {
  it('script senza alias ma con fields: niente voci per sequence, fields, mode', () => {
    const text = 'saluta:\n  fields:\n    nome:\n      description: Nome\n  sequence: []\n  mode: single\nnotte:\n  sequence: []\n';
    assert.deepEqual(buildOutline(text), [
      { label: 'saluta', line: 1, depth: 0 },
      { label: 'notte', line: 7, depth: 0 },
    ]);
    // Gli helper senza opzioni (valore vuoto) restano voci.
    assert.deepEqual(buildOutline('input_boolean:\n  ospiti:\n  vacanza:\n    name: Vacanza\n').map((i) => i.label), [
      'input_boolean',
      'ospiti',
      'Vacanza',
    ]);
  });

  it('file oltre il limite: elenco vuoto segnato tooLarge', () => {
    const big = buildOutline('a: 1\n'.repeat(Math.ceil(OUTLINE_MAX_CHARS / 5) + 1)) as Outline;
    assert.equal(big.length, 0);
    assert.equal(big.tooLarge, true);
    assert.equal((buildOutline('a: 1\n') as Outline).tooLarge, undefined);
  });
});

describe('snippet dalla selezione', () => {
  it('toglie alle righe successive il rientro che precede la selezione', () => {
    assert.equal(normalizeSnippetBody('- action: x\n      data:\n        a: 1', 4), '- action: x\n  data:\n    a: 1');
    assert.equal(normalizeSnippetBody('a\n  b', 0), 'a\n  b');
    // Mai testo: una riga meno rientrata perde solo i suoi spazi.
    assert.equal(normalizeSnippetBody('a: 1\n  b: 2\n\nc: 3', 4), 'a: 1\nb: 2\n\nc: 3');
  });
});

describe('collegamenti: casi limite', () => {
  it('niente collegamenti nei commenti e nei testi tra virgolette', () => {
    assert.deepEqual(linksIn('a: "!include x.yaml" # !secret y'), []);
    assert.deepEqual(
      linksIn('b: [!secret uno, !include "due.yaml"]').map((l) => l.target),
      ['uno', 'due.yaml'],
    );
  });
});
