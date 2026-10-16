import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
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

  it('rifiuta identificativi di versione non validi', async () => {
    await assert.rejects(store.read('a.yaml', '../../etc/passwd'));
  });
});
