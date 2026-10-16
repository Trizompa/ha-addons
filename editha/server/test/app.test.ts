import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig, supervisorToken } from '../src/config.js';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeIp } from '../src/security/ingress.js';
import { makeSandbox, testConfig, writeTree, type Sandbox } from './helpers.js';

const INGRESS = '172.30.32.2';

describe('API', () => {
  let sb: Sandbox;
  let app: FastifyInstance;

  before(async () => {
    sb = await makeSandbox();
    await writeTree(sb.configDir, { 'configuration.yaml': 'a: 1\n', 'packages/x.yaml': '' });
    app = await buildApp(testConfig(sb), { logger: false });
  });

  after(async () => {
    await app.close();
    await sb.cleanup();
  });

  const call = (opts: { method: 'GET' | 'PUT' | 'POST' | 'DELETE'; url: string; payload?: object }) =>
    app.inject({ ...opts, remoteAddress: INGRESS });

  describe('Ingress (SEC-1)', () => {
    it('accetta il proxy Ingress, anche in forma IPv6', async () => {
      assert.equal((await call({ method: 'GET', url: '/api/health' })).statusCode, 200);
      const v6 = await app.inject({ method: 'GET', url: '/api/health', remoteAddress: `::ffff:${INGRESS}` });
      assert.equal(v6.statusCode, 200);
    });

    it('rifiuta qualsiasi altro indirizzo, anche con X-Forwarded-For falsificato', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/tree',
        remoteAddress: '192.168.1.50',
        headers: { 'x-forwarded-for': INGRESS },
      });
      assert.equal(res.statusCode, 403);
      assert.equal(res.json().error.code, 'forbidden_origin');
    });

    it('normalizza gli indirizzi IPv4 mappati', () => {
      assert.equal(normalizeIp('::ffff:10.0.0.1'), '10.0.0.1');
      assert.equal(normalizeIp(undefined), '');
    });
  });

  it('serve la pagina provvisoria', async () => {
    const res = await call({ method: 'GET', url: '/' });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'] as string, /text\/html/);
  });

  it('percorre il ciclo leggi → salva → conflitto → versioni', async () => {
    const tree = await call({ method: 'GET', url: '/api/tree' });
    assert.equal(tree.statusCode, 200);
    assert.deepEqual(
      tree.json().entries.map((e: { name: string }) => e.name),
      ['packages', 'configuration.yaml'],
    );

    const read = await call({ method: 'GET', url: '/api/file?path=configuration.yaml' });
    const { etag, content } = read.json();
    assert.equal(content, 'a: 1\n');

    const save = await call({
      method: 'PUT',
      url: '/api/file',
      payload: { path: 'configuration.yaml', content: 'a: 2\n', etag },
    });
    assert.equal(save.statusCode, 200);

    const stale = await call({
      method: 'PUT',
      url: '/api/file',
      payload: { path: 'configuration.yaml', content: 'a: 3\n', etag },
    });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().error.code, 'conflict');
    assert.equal(stale.json().error.details.etag, save.json().etag);

    const versions = await call({ method: 'GET', url: '/api/versions?path=configuration.yaml' });
    assert.equal(versions.json().versions.length, 1);
    const id = versions.json().versions[0].id;

    const version = await call({ method: 'GET', url: `/api/version?path=configuration.yaml&id=${id}` });
    assert.equal(version.json().content, 'a: 1\n');

    const restored = await call({ method: 'POST', url: '/api/restore', payload: { path: 'configuration.yaml', id } });
    assert.equal(restored.statusCode, 200);
    const after = await call({ method: 'GET', url: '/api/file?path=configuration.yaml' });
    assert.equal(after.json().content, 'a: 1\n');
    assert.equal(after.json().etag, restored.json().etag);
  });

  it('duplica un file', async () => {
    const copy = await call({
      method: 'POST',
      url: '/api/copy',
      payload: { from: 'configuration.yaml', to: 'configuration_copia.yaml' },
    });
    assert.equal(copy.statusCode, 201);
    assert.equal(copy.json().path, 'configuration_copia.yaml');
    const again = await call({
      method: 'POST',
      url: '/api/copy',
      payload: { from: 'configuration.yaml', to: 'configuration_copia.yaml' },
    });
    assert.equal(again.statusCode, 409);
  });

  it('conserva, elenca e scarta le bozze (ED-14)', async () => {
    const empty = await call({ method: 'GET', url: '/api/drafts' });
    assert.deepEqual(empty.json(), { drafts: [] });
    const put = await call({
      method: 'PUT',
      url: '/api/draft',
      payload: { path: 'configuration.yaml', content: 'a: 9\n', etag: 'e1' },
    });
    assert.equal(put.statusCode, 200);
    await call({ method: 'PUT', url: '/api/draft', payload: { path: 'configuration.yaml', content: 'a: 10\n', etag: 'e1' } });
    const list = (await call({ method: 'GET', url: '/api/drafts' })).json().drafts;
    assert.equal(list.length, 1);
    assert.equal(list[0].content, 'a: 10\n');
    assert.equal(list[0].etag, 'e1');
    const big = await call({
      method: 'PUT',
      url: '/api/draft',
      payload: { path: 'x.yaml', content: 'x'.repeat(2 * 1024 * 1024), etag: 'e' },
    });
    assert.equal(big.statusCode, 413);
    await call({ method: 'DELETE', url: '/api/draft?path=configuration.yaml' });
    assert.deepEqual((await call({ method: 'GET', url: '/api/drafts' })).json(), { drafts: [] });
  });

  it('crea, rinomina ed elimina', async () => {
    const created = await call({
      method: 'POST',
      url: '/api/file',
      payload: { path: 'packages/nuovo.yaml', type: 'file' },
    });
    assert.equal(created.statusCode, 201);

    const renamed = await call({
      method: 'POST',
      url: '/api/rename',
      payload: { from: 'packages/nuovo.yaml', to: 'packages/rinominato.yaml' },
    });
    assert.equal(renamed.statusCode, 200);
    assert.equal(renamed.json().path, 'packages/rinominato.yaml');

    const removed = await call({ method: 'DELETE', url: '/api/file?path=packages/rinominato.yaml' });
    assert.equal(removed.statusCode, 200);
    const gone = await call({ method: 'GET', url: '/api/file?path=packages/rinominato.yaml' });
    assert.equal(gone.statusCode, 404);
  });

  it('rifiuta i percorsi fuori da /config (SEC-2)', async () => {
    for (const p of ['../data/x', '/etc/passwd', 'packages/../../outside']) {
      const res = await call({ method: 'GET', url: `/api/file?path=${encodeURIComponent(p)}` });
      assert.equal(res.statusCode, 403, p);
      assert.equal(res.json().error.code, 'forbidden_path');
    }
  });

  it('valida le richieste', async () => {
    const missing = await call({ method: 'GET', url: '/api/file' });
    assert.equal(missing.statusCode, 400);
    assert.equal(missing.json().error.code, 'invalid_request');

    const badType = await call({ method: 'POST', url: '/api/file', payload: { path: 'x', type: 'link' } });
    assert.equal(badType.statusCode, 400);
  });
});

describe('loadConfig', () => {
  it('usa i valori predefiniti dell\'add-on', () => {
    const cfg = loadConfig({});
    assert.equal(cfg.configDir, '/config');
    assert.equal(cfg.dataDir, '/data');
    assert.equal(cfg.port, 8099);
    assert.deepEqual(cfg.allowedIps, [INGRESS]);
  });

  it('trova il token del Supervisor anche se s6 non lo passa al processo', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 's6env-'));
    assert.equal(supervisorToken({}, dir), '');
    await writeFile(path.join(dir, 'SUPERVISOR_TOKEN'), 'da-s6\n');
    assert.equal(supervisorToken({}, dir), 'da-s6');
    assert.equal(supervisorToken({ SUPERVISOR_TOKEN: 'da-env' }, dir), 'da-env');
  });

  it('rifiuta valori numerici non validi', () => {
    assert.throws(() => loadConfig({ EDITHA_PORT: 'abc' }));
    assert.throws(() => loadConfig({ EDITHA_MAX_FILE_SIZE: '-1' }));
  });
});
