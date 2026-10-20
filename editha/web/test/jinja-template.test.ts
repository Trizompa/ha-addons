import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { entitiesIn, syntaxErrorLine, templateAt } from '../src/editor/jinja-template.js';

/** Template sotto il cursore, messo dove nel testo c'è "‸". */
function at(text: string, language = 'yaml') {
  const pos = text.indexOf('‸');
  const doc = text.replace('‸', '');
  return templateAt(doc, pos, pos, language);
}

describe('anteprima template: cosa si manda (HA-7)', () => {
  it('valore tra virgolette su una riga, anche col cursore sulla chiave o sul rientro', () => {
    const doc = '- condition: template\n  value_template: "{{ is_state(\'sun.sun\', \'below_horizon\') }}"\n';
    const want = "{{ is_state('sun.sun', 'below_horizon') }}";
    assert.equal(at(doc.replace('below', '‸below'))?.template, want);
    assert.equal(at(doc.replace('value_template', 'value_‸template'))?.template, want);
    assert.equal(at(doc.replace('  value_template', '‸  value_template'))?.template, want);
    assert.equal(at(doc.replace('  value_template', '‸  value_template'))?.line, 2);
  });

  it('virgolette singole raddoppiate e sequenze nelle doppie', () => {
    assert.equal(at("msg: '{{ states(''sensor.x'') ‸}}'")?.template, "{{ states('sensor.x') }}");
    assert.equal(at('msg: "{{ \\"a\\" ‸}}\\n\\u00e8"')?.template, '{{ "a" }}\nè');
    assert.equal(at('msg: "{{ a }}\\\n  b‸"')?.template, '{{ a }}b');
  });

  it('blocco | con il cursore su una riga più rientrata che sembra una chiave', () => {
    const doc = ['message: |', '  {% if is_state("a","on") %}', '    Ora: {{ now() }}‸', '  {% endif %}', 'title: x', ''].join('\n');
    const src = at(doc);
    assert.equal(src?.template, '{% if is_state("a","on") %}\n  Ora: {{ now() }}\n{% endif %}\n');
    assert.equal(src?.line, 2);
  });

  it('voce di elenco con blocco: le chiavi sorelle restano fuori', () => {
    assert.equal(at('- value_template: >-\n    {{ a ‸}}\n  for: 5\n')?.template, '{{ a }}');
    assert.equal(at('actions:\n  - message: |\n      {{ a }}‸\n    title: "x"\n')?.template, '{{ a }}\n');
  });

  it('blocco >- ripiegato come in YAML', () => {
    const src = at('value_template: >-‸\n  {{ states("a")\n  | int }}\n\n  {{ 2 }}\nnext: 1\n');
    assert.equal(src?.template, '{{ states("a") | int }}\n{{ 2 }}');
  });

  it('stringa tra virgolette che va a capo', () => {
    const src = at('value_template: "{{ is_state(\'a\', \'on\')\n  and ‸is_state(\'b\', \'on\') }}"\nnext: 1\n');
    assert.equal(src?.template, "{{ is_state('a', 'on') and is_state('b', 'on') }}");
  });

  it('elenchi, ancore e tag: solo il valore', () => {
    assert.equal(at('conditions:\n  - "{{ true ‸}}"\n')?.template, '{{ true }}');
    assert.equal(at('l: ["{{ a ‸}}", b]\n')?.template, '{{ a }}');
    assert.equal(at('k: &x "{{ x ‸}}"\n')?.template, '{{ x }}');
    assert.equal(at('k: !!str "{{ x ‸}}"\n')?.template, '{{ x }}');
  });

  it('niente template sotto il cursore', () => {
    assert.equal(at('automation:\n  - alias: Luci‸\n    mode: single\n'), null);
    assert.equal(at('autom‸ation:\n  - alias: Luci\n'), null);
    assert.equal(at('x = 1‸', 'python'), null);
  });

  it('cursore dopo il valore, oltre spazi o un commento', () => {
    assert.equal(at('k: "{{ a }}"   ‸\n')?.template, '{{ a }}');
    assert.equal(at('k: "{{ a }}" # nota‸\n')?.template, '{{ a }}');
  });

  it('documento con fine riga CRLF', () => {
    assert.equal(at('a: 1\r\nb: "{{ 2 }}"‸\r\nc: 3\r\n')?.template, '{{ 2 }}');
  });

  it('la selezione vince (solo se contiene un template), il file Jinja si manda intero', () => {
    const doc = 'a: "{{ 1 }}"\nb: "{{ 2 }}"\n';
    const sel = templateAt(doc, doc.indexOf('{{ 2'), doc.indexOf('2 }}') + 4, 'yaml');
    assert.equal(sel?.template, '{{ 2 }}');
    assert.equal(sel?.line, 2);
    assert.equal(templateAt(doc, 0, 1, 'yaml'), null);
    const jinja = templateAt('{% set x = 1 %}\n{{ x }}\n', 0, 0, 'jinja');
    assert.equal(jinja?.template, '{% set x = 1 %}\n{{ x }}\n');
  });
});

describe('anteprima template: riga dell\'errore ed entità (HA-7)', () => {
  it('trova blocchi non chiusi, chiusure senza apertura e parentesi aperte', () => {
    assert.equal(syntaxErrorLine('a\n{% if x %}\nb'), 2);
    assert.equal(syntaxErrorLine('{% for a in b %}\n{% endif %}\n{% endfor %}'), 2);
    assert.equal(syntaxErrorLine('x\ny {{ states("a")\n'), 2);
    assert.equal(syntaxErrorLine('{% else %}'), 1);
    assert.equal(syntaxErrorLine('{%- if a -%}{% elif b %}{% else %}{%+ endif %}'), null);
    assert.equal(syntaxErrorLine('{% set x = 1 %}{% set y %}a{% endset %}{{ x }}'), null);
    assert.equal(syntaxErrorLine('{% raw %}{% if %}{% endraw %}'), null);
    assert.equal(syntaxErrorLine('{% raw %}{{{% endraw %}'), null);
    assert.equal(syntaxErrorLine('{% raw %}\n{{'), 1);
    assert.equal(syntaxErrorLine('{{ x | int(0) }} {# nota #}'), null);
  });

  it('elenca le entità citate', () => {
    assert.deepEqual(
      entitiesIn("{{ states('sensor.a') }} {{ is_state(\"light.b\", 'on') }} {{ states.switch.c.state }} {{ 'light.turn_on' }}"),
      ['sensor.a', 'light.b', 'switch.c'],
    );
    assert.deepEqual(entitiesIn("{# states('sensor.old') #}{{ 'states.light.x' }}{% raw %}{{ states('a.b') }}{% endraw %}"), []);
    assert.deepEqual(entitiesIn("It's {{ states.sensor.x.state }} o'clock"), ['sensor.x']);
  });

  it('le righe corrispondono al file solo se il template non è ripiegato', () => {
    assert.equal(at('k: |\n  {{ a ‸}}\n  b\n')?.linear, true);
    assert.equal(at('k: >\n  {{ a ‸}}\n  b\n')?.linear, false);
    assert.equal(at('k: "{{ a }}\n  {% if x ‸%}"\n')?.linear, false);
    assert.equal(at('k: a {{ b }}\n  {% if x ‸%}\n')?.linear, false);
    assert.equal(at('k: >\n  {{ a ‸}}\n\n  b\n')?.linear, false);
    assert.equal(at('k: "{{ a ‸}}"\n')?.linear, true);
  });
});
