import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectLang, dictionary, setLang, t } from '../src/i18n/index.js';

describe('traduzioni', () => {
  it('italiano e inglese hanno le stesse chiavi e nessun testo vuoto', () => {
    const itKeys = Object.keys(dictionary('it')).sort();
    const enKeys = Object.keys(dictionary('en')).sort();
    assert.deepEqual(enKeys, itKeys);
    for (const lang of ['it', 'en'] as const) {
      for (const [key, value] of Object.entries(dictionary(lang))) assert.ok(value.trim(), `${lang}:${key}`);
    }
  });

  it('i segnaposto {nome} sono gli stessi nelle due lingue', () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const en = dictionary('en') as Record<string, string>;
    for (const [key, value] of Object.entries(dictionary('it'))) assert.deepEqual(names(en[key]!), names(value), key);
  });

  it('sostituisce i segnaposto e segue la lingua scelta', () => {
    setLang('en');
    assert.equal(t('save.done', { name: 'a.yaml' }), 'Saved a.yaml');
    setLang('it');
    assert.equal(t('save.done', { name: 'a.yaml' }), 'Salvato a.yaml');
  });

  it('sceglie l\'italiano solo se il browser è in italiano', () => {
    assert.equal(detectLang(['it-IT', 'en']), 'it');
    assert.equal(detectLang(['en-US', 'it']), 'it');
    assert.equal(detectLang(['de-DE']), 'en');
  });
});
