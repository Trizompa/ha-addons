import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, type Transaction } from '@codemirror/state';
import { snippet } from '@codemirror/autocomplete';
import { parseAllDocuments } from 'yaml';
import { builtinSnippets, fillIds } from '../src/editor/snippets.js';
import { setLang } from '../src/i18n/index.js';
import { lintYaml } from '../src/editor/yaml-lint.js';

/** Inserisce uno snippet come farebbe l'editor e restituisce il testo risultante. */
function expand(body: string): string {
  let state = EditorState.create({ doc: '' });
  const view = {
    get state() {
      return state;
    },
    dispatch(tr: Transaction) {
      state = tr.state;
    },
  };
  snippet(fillIds(body, 1700000000000).replace(/\n$/, ''))(view as never, null, 0, 0);
  return state.doc.toString();
}

describe('snippet predefiniti', () => {
  for (const s of builtinSnippets()) {
    it(`${s.name}: si inserisce per intero ed è YAML valido`, () => {
      const text = expand(s.body);
      assert.ok(!text.includes('${'), text);
      assert.ok(!text.includes('{{ID}}'), text);
      assert.deepEqual(lintYaml(text), [], text);
      assert.ok(parseAllDocuments(text).length > 0);
    });
  }

  it('in inglese traduce nomi e testi di esempio', () => {
    setLang('en');
    try {
      const auto = builtinSnippets().find((s) => s.id === 'automation')!;
      assert.equal(auto.name, 'Automation');
      assert.match(expand(auto.body), /alias: Automation name/);
      assert.match(expand(auto.body), /binary_sensor\.example/);
    } finally {
      setLang('it');
    }
  });

  it('mantiene gli orari completi', () => {
    assert.match(expand(builtinSnippets().find((s) => s.id === 'trigger-time')!.body), /at: "07:00:00"/);
    const t = expand(builtinSnippets().find((s) => s.id === 'condition-time')!.body);
    assert.match(t, /after: "08:00:00"/);
    assert.match(t, /before: "22:00:00"/);
  });
});
