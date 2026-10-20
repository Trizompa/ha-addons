import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { BackupStore } from '../src/backups/store.js';
import { makeSandbox, type Sandbox } from './helpers.js';

describe('BackupStore', () => {
  let sb: Sandbox;
  let clock: Date;
  let store: BackupStore;

  beforeEach(async () => {
    sb = await makeSandbox();
    clock = new Date('2026-10-15T08:00:00.000Z');
    store = new BackupStore(path.join(sb.dataDir, 'backups'), 3, () => clock);
  });

  afterEach(() => sb.cleanup());

  it('calcola lo spazio occupato, in tutto e per file', async () => {
    assert.deepEqual(await store.usage(), { totalBytes: 0, versions: 0, files: [] });
    await store.saveFile('a.yaml', Buffer.from('12345'), 'save');
    clock = new Date('2026-10-15T08:00:01.000Z');
    await store.saveFile('a.yaml', Buffer.from('123'), 'save');
    await store.saveFile('b/c.yaml', Buffer.from('1'), 'delete');
    await mkdir(path.join(sb.configDir, 'cartella'), { recursive: true });
    await writeFile(path.join(sb.configDir, 'cartella/x.txt'), 'ciao');
    await store.saveTree('cartella', path.join(sb.configDir, 'cartella'), 'delete');
    const usage = await store.usage();
    assert.equal(usage.versions, 4);
    // Spazio su disco: blocchi, indici e cartelle compresi, quindi almeno i byte dei contenuti.
    assert.ok(usage.totalBytes >= 5 + 3 + 1 + 4);
    assert.deepEqual(
      usage.files.map((f) => [f.path, f.versions]).sort(),
      [
        ['a.yaml', 2],
        ['b/c.yaml', 1],
        ['cartella', 1],
      ],
    );
    assert.equal(usage.files.reduce((n, f) => n + f.bytes, 0) <= usage.totalBytes, true);
    assert.ok(usage.files.every((f) => f.bytes > 0));
    // Un avanzo di scrittura interrotta conta nel totale.
    const before = usage.totalBytes;
    const key = createHash('sha256').update('a.yaml').digest('hex');
    await writeFile(path.join(sb.dataDir, 'backups', key, '.tmp-resto'), 'x'.repeat(10_000));
    assert.ok((await store.usage()).totalBytes >= before + 10_000);
    assert.equal(usage.files[0]!.oldest, '2026-10-15T08:00:00.000Z');
    assert.equal(usage.files[0]!.newest, '2026-10-15T08:00:01.000Z');
  });

  it('elenca le versioni dalla più recente', async () => {
    await store.saveFile('a.yaml', Buffer.from('1'), 'save');
    clock = new Date('2026-10-15T08:00:01.000Z');
    await store.saveFile('a.yaml', Buffer.from('2'), 'delete');
    const versions = await store.list('a.yaml');
    assert.deepEqual(
      versions.map((v) => [v.reason, v.createdAt]),
      [
        ['delete', '2026-10-15T08:00:01.000Z'],
        ['save', '2026-10-15T08:00:00.000Z'],
      ],
    );
  });

  it('distingue versioni create nello stesso millisecondo', async () => {
    await store.saveFile('a.yaml', Buffer.from('1'), 'save');
    await store.saveFile('a.yaml', Buffer.from('2'), 'save');
    const versions = await store.list('a.yaml');
    assert.equal(versions.length, 2);
    assert.equal((await store.read('a.yaml', versions[0]!.id)).toString(), '2');
  });

  it('conserva solo le ultime N versioni', async () => {
    for (let i = 0; i < 5; i++) {
      clock = new Date(Date.UTC(2026, 9, 15, 8, 0, i));
      await store.saveFile('a.yaml', Buffer.from(String(i)), 'save');
    }
    const versions = await store.list('a.yaml');
    assert.equal(versions.length, 3);
    assert.equal((await store.read('a.yaml', versions[0]!.id)).toString(), '4');
    assert.equal((await store.read('a.yaml', versions[2]!.id)).toString(), '2');
  });

  it('tiene separate le cronologie di percorsi diversi', async () => {
    await store.saveFile('a.yaml', Buffer.from('a'), 'save');
    await store.saveFile('a.yaml/b', Buffer.from('b'), 'save');
    assert.equal((await store.list('a.yaml')).length, 1);
    assert.equal((await store.list('a.yaml/b')).length, 1);
  });

  it('id sempre crescenti anche se l\'orologio torna indietro; la versione nuova non viene mai eliminata', async () => {
    for (let i = 0; i < 5; i++) {
      clock = new Date(Date.UTC(2026, 9, 15, 8, 0, 0) - i * 3600_000);
      await store.saveFile('a.yaml', Buffer.from(String(i)), 'save');
    }
    const versions = await store.list('a.yaml');
    assert.equal(versions.length, 3);
    assert.deepEqual(
      await Promise.all(versions.map(async (v) => (await store.read('a.yaml', v.id)).toString())),
      ['4', '3', '2'],
    );
    assert.ok(versions[0]!.id > versions[1]!.id);
  });

  it('non duplica una versione uguale all\'ultima', async () => {
    const a = await store.saveFile('a.yaml', Buffer.from('uguale'), 'save');
    const b = await store.saveFile('a.yaml', Buffer.from('uguale'), 'restore');
    assert.equal(a, b);
    const src = path.join(sb.dataDir, 'src.txt');
    await writeFile(src, 'uguale');
    assert.equal(await store.saveFileFrom('a.yaml', src, 'delete'), a);
    assert.equal((await store.list('a.yaml')).length, 1);
  });

  it('una copia non riuscita non lascia versioni né file temporanei', async () => {
    await assert.rejects(store.saveFileFrom('a.yaml', path.join(sb.dataDir, 'manca'), 'delete'));
    assert.equal((await store.list('a.yaml')).length, 0);
    const dir = path.join(sb.dataDir, 'backups', createHash('sha256').update('a.yaml').digest('hex'));
    assert.deepEqual(await readdir(dir), ['index.json']);
  });

  it('ordina i vecchi suffissi numerici (.10 dopo .2)', async () => {
    const dir = path.join(sb.dataDir, 'backups', createHash('sha256').update('a.yaml').digest('hex'));
    await mkdir(dir, { recursive: true });
    for (const id of ['20261015T080000000Z-save', '20261015T080000000Z.2-save', '20261015T080000000Z.10-save']) {
      await writeFile(path.join(dir, id), id);
    }
    assert.deepEqual(
      (await store.list('a.yaml')).map((v) => v.id),
      ['20261015T080000000Z.10-save', '20261015T080000000Z.2-save', '20261015T080000000Z-save'],
    );
  });

  it('rifiuta identificativi di versione non validi', async () => {
    await assert.rejects(store.read('a.yaml', '../../etc/passwd'));
  });
});
