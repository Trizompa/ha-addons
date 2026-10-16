import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, symlink } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { crc32 } from '../src/fs/zip.js';
import { makeSandbox, testConfig, writeTree, type Sandbox } from './helpers.js';

const INGRESS = '172.30.32.2';

/** Lettore ZIP minimo per verificare l'archivio prodotto. */
function readZip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const lname = buf.readUInt16LE(local + 26);
    const start = local + 30 + lname;
    const body = buf.subarray(start, start + csize);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    assert.equal(crc32(data), crc, name);
    out.set(name, data);
    p += 46 + nameLen;
  }
  return out;
}

describe('upload e download (FS-6)', () => {
  let sb: Sandbox;
  let app: FastifyInstance;

  before(async () => {
    sb = await makeSandbox();
    await writeTree(sb.configDir, {
      'configuration.yaml': 'a: 1\n',
      'www/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]),
      'www/icona.SVG': '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      'www/manuale.pdf': '%PDF-1.4\n',
      'packages/luci.yaml': 'light: []\n',
      'packages/sub/città.yaml': 'x: è\n',
      '.storage/core.config': '{}',
    });
    await symlink(sb.outsideDir, path.join(sb.configDir, 'packages/fuori'));
    app = await buildApp(testConfig(sb), { logger: false });
  });

  after(async () => {
    await app.close();
    await sb.cleanup();
  });

  const upload = (dir: string, name: string, body: Buffer, overwrite = false) =>
    app.inject({
      method: 'POST',
      url: `/api/upload?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(name)}&overwrite=${overwrite}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: body,
      remoteAddress: INGRESS,
    });
  const download = (p: string) =>
    app.inject({ method: 'GET', url: `/api/download?path=${encodeURIComponent(p)}`, remoteAddress: INGRESS });

  const preview = (p: string) =>
    app.inject({ method: 'GET', url: `/api/preview?path=${encodeURIComponent(p)}`, remoteAddress: INGRESS });

  it('non converte i tipi: un contenuto null non svuota il file', async () => {
    const read = await app.inject({ method: 'GET', url: '/api/file?path=configuration.yaml', remoteAddress: INGRESS });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/file',
      payload: { path: 'configuration.yaml', content: null, etag: read.json().etag },
      remoteAddress: INGRESS,
    });
    assert.equal(res.statusCode, 400);
    assert.equal(await readFile(path.join(sb.configDir, 'configuration.yaml'), 'utf8'), 'a: 1\n');
  });

  it('FS-10: anteprima di immagini e PDF con il tipo giusto, mostrata e non scaricata', async () => {
    const png = await preview('www/logo.png');
    assert.equal(png.statusCode, 200);
    assert.equal(png.headers['content-type'], 'image/png');
    assert.equal(png.headers['content-disposition'], 'inline');
    assert.equal(png.headers['x-content-type-options'], 'nosniff');
    assert.deepEqual(png.rawPayload, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
    const pdf = await preview('www/manuale.pdf');
    assert.equal(pdf.headers['content-type'], 'application/pdf');
  });

  it('FS-10: un SVG in anteprima non può eseguire script', async () => {
    const res = await preview('www/icona.SVG');
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'image/svg+xml');
    assert.match(res.headers['content-security-policy'] as string, /sandbox/);
    assert.match(res.headers['content-security-policy'] as string, /default-src 'none'/);
  });

  it('FS-10: niente anteprima per gli altri file né fuori da /config', async () => {
    const yaml = await preview('configuration.yaml');
    assert.equal(yaml.statusCode, 415);
    assert.equal(yaml.json().error.code, 'not_previewable');
    assert.equal((await preview('../fuori.png')).statusCode, 403);
    assert.equal((await preview('www/manca.png')).statusCode, 404);
  });

  it('scarica un file binario così com\'è, con il nome giusto', async () => {
    const res = await download('www/logo.png');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.rawPayload, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
    assert.match(res.headers['content-disposition'] as string, /attachment; filename="logo.png"/);
  });

  it('scarica una cartella come ZIP con sottocartelle e nomi accentati, senza link simbolici', async () => {
    const res = await download('packages');
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'application/zip');
    assert.match(res.headers['content-disposition'] as string, /filename="packages.zip"/);
    const files = readZip(res.rawPayload);
    assert.deepEqual([...files.keys()].sort(), ['luci.yaml', 'sub/città.yaml']);
    assert.equal(files.get('sub/città.yaml')!.toString(), 'x: è\n');
  });

  it('carica un file nuovo in una cartella', async () => {
    const res = await upload('www', 'icona.png', Buffer.from([1, 2, 3]));
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().path, 'www/icona.png');
    assert.deepEqual(await readFile(path.join(sb.configDir, 'www/icona.png')), Buffer.from([1, 2, 3]));
  });

  it('non sovrascrive senza conferma; con conferma tiene la versione precedente nei backup', async () => {
    const conflict = await upload('', 'configuration.yaml', Buffer.from('a: 2\n'));
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().error.code, 'already_exists');
    assert.equal(await readFile(path.join(sb.configDir, 'configuration.yaml'), 'utf8'), 'a: 1\n');

    const ok = await upload('', 'configuration.yaml', Buffer.from('a: 2\n'), true);
    assert.equal(ok.statusCode, 201);
    assert.equal(await readFile(path.join(sb.configDir, 'configuration.yaml'), 'utf8'), 'a: 2\n');
    const versions = await app.inject({
      method: 'GET',
      url: '/api/versions?path=configuration.yaml',
      remoteAddress: INGRESS,
    });
    assert.equal(versions.json().versions.length, 1);
  });

  it('rifiuta cartelle protette, nomi pericolosi e cartelle fuori da /config', async () => {
    assert.equal((await upload('.storage', 'x', Buffer.from('1'))).json().error.code, 'read_only');
    assert.equal((await upload('', '../fuori.yaml', Buffer.from('1'))).statusCode, 400);
    assert.equal((await upload('', '..', Buffer.from('1'))).statusCode, 400);
    assert.equal((await upload('../', 'x.yaml', Buffer.from('1'))).json().error.code, 'forbidden_path');
    assert.equal((await upload('packages/fuori', 'x.yaml', Buffer.from('1'))).json().error.code, 'forbidden_path');
  });

  it('rispetta il limite di dimensione', async () => {
    const res = await upload('', 'grande.bin', Buffer.alloc(3 * 1024 * 1024));
    assert.equal(res.statusCode, 413);
  });
});
