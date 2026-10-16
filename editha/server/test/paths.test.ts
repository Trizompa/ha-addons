import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, symlink } from 'node:fs/promises';
import { PathGuard } from '../src/fs/paths.js';
import { EdithaError } from '../src/errors.js';
import { makeSandbox, writeTree, type Sandbox } from './helpers.js';

function rejectsWith(code: string) {
  return (err: unknown) => err instanceof EdithaError && err.code === code;
}

describe('PathGuard', () => {
  let sb: Sandbox;
  let guard: PathGuard;

  before(async () => {
    sb = await makeSandbox();
    await writeTree(sb.configDir, {
      'configuration.yaml': 'x',
      'packages/lights.yaml': 'y',
      '.storage/core.config': '{}',
    });
    await writeTree(sb.outsideDir, { 'secret.txt': 'fuori' });
    await symlink(sb.outsideDir, path.join(sb.configDir, 'escape'));
    await symlink(path.join(sb.outsideDir, 'secret.txt'), path.join(sb.configDir, 'escape.txt'));
    await symlink(path.join(sb.configDir, 'packages'), path.join(sb.configDir, 'pkg-link'));
    await symlink(path.join(sb.configDir, '.storage'), path.join(sb.configDir, 'storage-link'));
    await mkdir(path.join(sb.configDir, 'empty'));
    guard = await PathGuard.create(sb.configDir);
  });

  after(() => sb.cleanup());

  describe('normalize', () => {
    it('accetta percorsi relativi e li normalizza', () => {
      assert.equal(guard.normalize(''), '');
      assert.equal(guard.normalize('.'), '');
      assert.equal(guard.normalize('packages/./lights.yaml'), 'packages/lights.yaml');
      assert.equal(guard.normalize('packages/'), 'packages');
      assert.equal(guard.normalize('a/b/../c'), 'a/c');
    });

    it('rifiuta le uscite dalla radice', () => {
      for (const p of ['..', '../x', 'a/../../x', 'packages/../../outside/secret.txt']) {
        assert.throws(() => guard.normalize(p), rejectsWith('forbidden_path'), p);
      }
    });

    it('rifiuta percorsi assoluti e byte nulli', () => {
      assert.throws(() => guard.normalize('/etc/passwd'), rejectsWith('forbidden_path'));
      assert.throws(() => guard.normalize('/config/configuration.yaml'), rejectsWith('forbidden_path'));
      assert.throws(() => guard.normalize('a\0b'), rejectsWith('invalid_request'));
    });
  });

  describe('resolveExisting', () => {
    it('risolve file dentro la radice', async () => {
      const r = await guard.resolveExisting('packages/lights.yaml');
      assert.equal(r.abs, path.join(sb.configDir, 'packages/lights.yaml'));
    });

    it('segue i link che restano dentro la radice', async () => {
      const r = await guard.resolveExisting('pkg-link/lights.yaml');
      assert.equal(r.abs, path.join(sb.configDir, 'packages/lights.yaml'));
    });

    it('rifiuta i link che escono dalla radice', async () => {
      await assert.rejects(guard.resolveExisting('escape/secret.txt'), rejectsWith('forbidden_path'));
      await assert.rejects(guard.resolveExisting('escape.txt'), rejectsWith('forbidden_path'));
    });

    it('segnala i percorsi inesistenti', async () => {
      await assert.rejects(guard.resolveExisting('missing.yaml'), rejectsWith('not_found'));
    });
  });

  describe('resolveEntry', () => {
    it('rifiuta voci la cui cartella è fuori dalla radice', async () => {
      await assert.rejects(guard.resolveEntry('escape/new.txt'), rejectsWith('forbidden_path'));
    });

    it('non segue il link finale', async () => {
      const r = await guard.resolveEntry('escape');
      assert.equal(r.abs, path.join(sb.configDir, 'escape'));
    });
  });

  describe('sola lettura', () => {
    it('blocca le cartelle protette anche attraverso un link', async () => {
      const direct = await guard.resolveExisting('.storage/core.config');
      const viaLink = await guard.resolveExisting('storage-link/core.config');
      assert.throws(() => guard.assertWritable(direct), rejectsWith('read_only'));
      assert.throws(() => guard.assertWritable(viaLink), rejectsWith('read_only'));
    });

    it('blocca la radice', async () => {
      assert.throws(() => guard.assertWritable({ rel: '', abs: guard.root }), rejectsWith('forbidden_path'));
    });

    it('consente il resto', async () => {
      guard.assertWritable(await guard.resolveExisting('configuration.yaml'));
    });
  });
});
