import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { makeSandbox, testConfig, type Sandbox } from './helpers.js';

const INGRESS = '172.30.32.2';
const TOKEN = 'token-di-prova';

interface FakeHa {
  url: string;
  calls: { method: string; path: string; auth: string | undefined }[];
  checkResult: { result: string; errors: string | null };
  close(): Promise<void>;
}

/** Finto Home Assistant Core con le poche API usate da Editha. */
async function startFakeHa(): Promise<FakeHa> {
  const fake: Omit<FakeHa, 'url' | 'close'> = { calls: [], checkResult: { result: 'valid', errors: null } };
  const server = http.createServer((req, res) => {
    fake.calls.push({ method: req.method!, path: req.url!, auth: req.headers.authorization });
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401).end();
      return;
    }
    const json = (data: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(data));
    if (req.method === 'GET' && req.url === '/api/states') {
      return json([
        { entity_id: 'sensor.temp', state: '21.5', attributes: { friendly_name: 'Temperatura', unit_of_measurement: '°C' } },
        { entity_id: 'light.cucina', state: 'off', attributes: { friendly_name: 'Luce cucina' } },
      ]);
    }
    if (req.method === 'GET' && req.url === '/api/services') {
      return json([{ domain: 'light', services: { turn_on: { name: 'Accendi', description: 'Accende' } } }]);
    }
    if (req.method === 'POST' && req.url === '/api/config/core/check_config') return json(fake.checkResult);
    if (req.method === 'POST' && req.url?.startsWith('/api/services/homeassistant/')) return json([]);
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return Object.assign(fake, {
    url: `http://127.0.0.1:${port}/api`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  });
}

describe('integrazione con Home Assistant', () => {
  let sb: Sandbox;
  let ha: FakeHa;
  let app: FastifyInstance;

  before(async () => {
    sb = await makeSandbox();
    ha = await startFakeHa();
    app = await buildApp(testConfig(sb, { haUrl: ha.url, haToken: TOKEN }), { logger: false });
  });

  after(async () => {
    await app.close();
    await ha.close();
    await sb.cleanup();
  });

  beforeEach(() => {
    ha.calls.length = 0;
    ha.checkResult = { result: 'valid', errors: null };
  });

  const call = (method: 'GET' | 'POST', url: string) => app.inject({ method, url, remoteAddress: INGRESS });

  it('elenca le entità con nome, stato e unità, usando il token solo lato server', async () => {
    const res = await call('GET', '/api/ha/entities?fresh=true');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().entities, [
      { entity_id: 'light.cucina', name: 'Luce cucina', state: 'off', unit: null },
      { entity_id: 'sensor.temp', name: 'Temperatura', state: '21.5', unit: '°C' },
    ]);
    assert.equal(ha.calls[0]?.auth, `Bearer ${TOKEN}`);
    assert.ok(!res.body.includes(TOKEN));
  });

  it('tiene le entità in cache per poco tempo', async () => {
    await call('GET', '/api/ha/entities?fresh=true');
    await call('GET', '/api/ha/entities');
    assert.equal(ha.calls.length, 1);
  });

  it('elenca i servizi come dominio.servizio', async () => {
    const res = await call('GET', '/api/ha/services?fresh=true');
    assert.deepEqual(res.json().services, [{ id: 'light.turn_on', name: 'Accendi', description: 'Accende' }]);
  });

  it('verifica la configurazione (ACT-1)', async () => {
    ha.checkResult = { result: 'invalid', errors: 'Invalid config for [light]: ...' };
    const res = await call('POST', '/api/ha/check');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { valid: false, errors: 'Invalid config for [light]: ...', warnings: null });
  });

  it('ricarica lo YAML solo dopo una verifica riuscita', async () => {
    const res = await call('POST', '/api/ha/reload');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(
      ha.calls.map((c) => c.path),
      ['/api/config/core/check_config', '/api/services/homeassistant/reload_all'],
    );
  });

  it('blocca ricarica e riavvio se la configurazione ha errori (ACT-4)', async () => {
    ha.checkResult = { result: 'invalid', errors: 'errore' };
    for (const url of ['/api/ha/reload', '/api/ha/restart']) {
      const res = await call('POST', url);
      assert.equal(res.statusCode, 409, url);
      assert.equal(res.json().error.code, 'config_invalid');
      assert.equal(res.json().error.details.errors, 'errore');
    }
    assert.ok(!ha.calls.some((c) => c.path.startsWith('/api/services/')));
  });

  it('riavvia HA dopo una verifica riuscita', async () => {
    const res = await call('POST', '/api/ha/restart');
    assert.equal(res.statusCode, 200);
    assert.equal(ha.calls.at(-1)?.path, '/api/services/homeassistant/restart');
  });
});

describe('senza Home Assistant', () => {
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

  it('lo segnala con un errore chiaro', async () => {
    const status = await app.inject({ method: 'GET', url: '/api/ha/status', remoteAddress: INGRESS });
    assert.deepEqual(status.json(), { available: false });
    const res = await app.inject({ method: 'POST', url: '/api/ha/check', remoteAddress: INGRESS });
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().error.code, 'ha_unavailable');
  });
});

describe('snippet personali', () => {
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

  it('salva e rilegge gli snippet', async () => {
    const list = { snippets: [{ id: 'a1', name: 'Luce', body: 'light.turn_on' }] };
    const put = await app.inject({ method: 'PUT', url: '/api/snippets', payload: list, remoteAddress: INGRESS });
    assert.equal(put.statusCode, 200);
    const get = await app.inject({ method: 'GET', url: '/api/snippets', remoteAddress: INGRESS });
    assert.deepEqual(get.json(), list);
  });

  it('rifiuta snippet non validi', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/snippets',
      payload: { snippets: [{ id: '', name: 'x', body: 'y' }] },
      remoteAddress: INGRESS,
    });
    assert.equal(res.statusCode, 400);
  });
});
