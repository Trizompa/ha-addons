import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { DEFAULT_SETTINGS } from '../src/state/settings.js';
import { makeSandbox, testConfig, type Sandbox } from './helpers.js';

const INGRESS = '172.30.32.2';

describe('impostazioni e sessione', () => {
  let sb: Sandbox;
  let app: FastifyInstance;

  before(async () => {
    sb = await makeSandbox();
    app = await buildApp(testConfig(sb), { logger: false });
  });

  after(async () => {
    await app.close();
    await sb.cleanup();
  });

  const call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
    app.inject({ method, url, remoteAddress: INGRESS, ...(payload ? { payload } : {}) });

  it('parte dai valori predefiniti', async () => {
    assert.deepEqual((await call('GET', '/api/settings')).json(), DEFAULT_SETTINGS);
    assert.deepEqual((await call('GET', '/api/session')).json(), { tabs: [], active: null });
  });

  it('salva il tema e lo ritrova (CFG-1, FEP #6)', async () => {
    const res = await call('POST', '/api/settings', { theme: 'dark' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().theme, 'dark');
    assert.equal(res.json().fontSize, DEFAULT_SETTINGS.fontSize);
    assert.equal((await call('GET', '/api/settings')).json().theme, 'dark');
    const disk = JSON.parse(await readFile(path.join(sb.dataDir, 'settings.json'), 'utf8'));
    assert.equal(disk.theme, 'dark');
  });

  it('rifiuta impostazioni non valide', async () => {
    assert.equal((await call('POST', '/api/settings', { theme: 'rosa' })).statusCode, 400);
    assert.equal((await call('POST', '/api/settings', { fontSize: 99 })).statusCode, 400);
    assert.equal((await call('POST', '/api/settings', { altro: 1 })).statusCode, 400);
    assert.equal((await call('POST', '/api/settings', { showSystem: 'si' })).statusCode, 400);
    assert.equal((await call('POST', '/api/settings', { language: 'fr' })).statusCode, 400);
  });

  it('ignora un file di impostazioni rovinato', async () => {
    await writeFile(path.join(sb.dataDir, 'settings.json'), '{ non json');
    assert.deepEqual((await call('GET', '/api/settings')).json(), DEFAULT_SETTINGS);
  });

  it('salva e ritrova la sessione (ED-11, FEP #13)', async () => {
    const session = {
      tabs: [
        { path: 'configuration.yaml', anchor: 10, head: 12, scrollTop: 0 },
        { path: 'automations.yaml', anchor: 0, head: 0, scrollTop: 340.5 },
      ],
      active: 'automations.yaml',
      side: 'configuration.yaml',
    };
    assert.equal((await call('PUT', '/api/session', session)).statusCode, 200);
    assert.deepEqual((await call('GET', '/api/session')).json(), session);
  });

  it('scarta una tab attiva che non è tra quelle aperte', async () => {
    await writeFile(
      path.join(sb.dataDir, 'session.json'),
      JSON.stringify({ tabs: [{ path: 'a.yaml', anchor: 0, head: 0, scrollTop: 0 }, { bad: true }], active: 'b.yaml' }),
    );
    assert.deepEqual((await call('GET', '/api/session')).json(), {
      tabs: [{ path: 'a.yaml', anchor: 0, head: 0, scrollTop: 0 }],
      active: null,
    });
  });
});

describe('interfaccia', () => {
  let sb: Sandbox;
  let app: FastifyInstance;

  before(async () => {
    sb = await makeSandbox();
    const webDir = path.join(sb.base, 'web');
    await mkdir(webDir);
    await writeFile(path.join(webDir, 'index.html'), '<!doctype html><title>Editha</title>');
    await writeFile(path.join(webDir, 'app.js'), 'console.log(1)');
    await writeFile(path.join(webDir, 'app.js.gz'), gzipSync('console.log(1)'));
    await writeFile(path.join(webDir, 'index.html.gz'), gzipSync('<!doctype html><title>Editha</title>'));
    app = await buildApp(testConfig(sb), { logger: false });
  });

  after(async () => {
    await app.close();
    await sb.cleanup();
  });

  it('serve index.html e gli asset senza cache a lungo termine', async () => {
    const index = await app.inject({ method: 'GET', url: '/', remoteAddress: INGRESS });
    assert.equal(index.statusCode, 200);
    assert.match(index.body, /<title>Editha<\/title>/);
    assert.equal(index.headers['cache-control'], 'no-cache');
    const js = await app.inject({ method: 'GET', url: '/app.js', remoteAddress: INGRESS });
    assert.equal(js.statusCode, 200);
    assert.match(js.headers['content-type'] as string, /javascript/);
  });

  it('serve le versioni compresse ai browser che le chiedono', async () => {
    for (const enc of ['br, gzip, deflate', 'gzip', '']) {
      const res = await app.inject({ method: 'GET', url: '/', remoteAddress: INGRESS, headers: { 'accept-encoding': enc } });
      assert.equal(res.statusCode, 200, `accept-encoding: ${enc}`);
    }
    const js = await app.inject({
      method: 'GET',
      url: '/app.js',
      remoteAddress: INGRESS,
      headers: { 'accept-encoding': 'gzip' },
    });
    assert.equal(js.statusCode, 200);
    assert.equal(js.headers['content-encoding'], 'gzip');
  });

    it('indica la build dell\'interfaccia nello stato di salute', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health', remoteAddress: INGRESS });
    assert.equal(res.json().status, 'ok');
    assert.match(res.json().build, /^\d+$/);
  });

    it('applica il filtro Ingress anche ai file statici', async () => {
    const res = await app.inject({ method: 'GET', url: '/', remoteAddress: '10.0.0.9' });
    assert.equal(res.statusCode, 403);
  });
});
