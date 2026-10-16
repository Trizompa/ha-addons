import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TabsModel, type Tab } from '../src/state/tabs.js';

function tab(path: string): Tab<string> {
  return { path, name: path.split('/').pop()!, etag: 'e', readOnly: false, state: `contenuto di ${path}`, dirty: false };
}

function model(...paths: string[]): TabsModel<string> {
  const m = new TabsModel<string>();
  for (const p of paths) m.open(tab(p));
  return m;
}

describe('TabsModel', () => {
  it('apre le tab dopo quella attiva e attiva la nuova', () => {
    const m = model('a', 'b', 'c');
    m.activate('a');
    m.open(tab('d'));
    assert.deepEqual(m.tabs.map((t) => t.path), ['a', 'd', 'b', 'c']);
    assert.equal(m.active?.path, 'd');
  });

  it('aggiunge in fondo senza cambiare la tab attiva (ripristino della sessione)', () => {
    const m = model('a');
    m.append(tab('b'));
    m.append(tab('c'));
    assert.deepEqual(m.tabs.map((t) => t.path), ['a', 'b', 'c']);
    assert.equal(m.active?.path, 'a');
  });

  it('non duplica una tab già aperta', () => {
    const m = model('a', 'b');
    m.open(tab('a'));
    assert.equal(m.tabs.length, 2);
    assert.equal(m.active?.path, 'a');
  });

  describe('chiusura (ED-4, FEP #19)', () => {
    it('chiudendo la tab attiva attiva quella a destra, con il suo contenuto', () => {
      const m = model('a', 'b', 'c');
      m.activate('b');
      const next = m.close('b');
      assert.equal(next?.path, 'c');
      assert.equal(next?.state, 'contenuto di c');
      assert.equal(m.active, next);
    });

    it('chiudendo l\'ultima a destra attiva quella a sinistra', () => {
      const m = model('a', 'b', 'c');
      assert.equal(m.close('c')?.path, 'b');
    });

    it('chiudendo una tab inattiva la tab attiva non cambia', () => {
      const m = model('a', 'b', 'c');
      m.activate('c');
      assert.equal(m.close('a')?.path, 'c');
      m.activate('b');
      assert.equal(m.close('c')?.path, 'b');
    });

    it('chiudendo l\'unica tab non resta nessuna tab attiva', () => {
      const m = model('a');
      assert.equal(m.close('a'), null);
      assert.equal(m.active, null);
    });

    it('chiudere tab in sequenza mantiene sempre coerente la tab attiva', () => {
      const m = model('a', 'b', 'c', 'd', 'e');
      m.activate('c');
      const seen: (string | undefined)[] = [];
      while (m.active) seen.push(m.close(m.active.path)?.path);
      assert.deepEqual(seen, ['d', 'e', 'b', 'a', undefined]);
    });
  });

  it('aggiorna percorsi e nomi dopo una rinomina (FEP #18)', () => {
    const m = model('packages/luci.yaml', 'packages/sub/a.yaml', 'packages2/x.yaml', 'automations.yaml');
    m.rename('packages', 'pacchetti');
    assert.deepEqual(m.tabs.map((t) => t.path), [
      'pacchetti/luci.yaml',
      'pacchetti/sub/a.yaml',
      'packages2/x.yaml',
      'automations.yaml',
    ]);
    m.rename('automations.yaml', 'automazioni.yaml');
    assert.equal(m.find('automazioni.yaml')?.name, 'automazioni.yaml');
  });

  it('trova le tab dentro una cartella', () => {
    const m = model('packages/a.yaml', 'packages2/b.yaml', 'c.yaml');
    assert.deepEqual(m.within('packages').map((t) => t.path), ['packages/a.yaml']);
  });

  it('sposta una tab mantenendo quella attiva', () => {
    const m = model('a', 'b', 'c');
    m.activate('b');
    m.move('a', 2);
    assert.deepEqual(m.tabs.map((t) => t.path), ['b', 'c', 'a']);
    assert.equal(m.active?.path, 'b');
  });
});
