import type { FastifyInstance } from 'fastify';
import type { FileService } from '../fs/files.js';

const pathQuery = {
  type: 'object',
  required: ['path'],
  properties: { path: { type: 'string' } },
} as const;

const optionalPathQuery = {
  type: 'object',
  properties: { path: { type: 'string', default: '' } },
} as const;

interface PathQuery {
  path: string;
}

export function registerFileRoutes(app: FastifyInstance, files: FileService): void {
  app.get<{ Querystring: PathQuery }>('/api/tree', { schema: { querystring: optionalPathQuery } }, async (req) => ({
    path: req.query.path,
    entries: await files.list(req.query.path),
  }));

  app.get<{ Querystring: PathQuery }>('/api/file', { schema: { querystring: pathQuery } }, async (req) =>
    files.read(req.query.path),
  );

  app.put<{ Body: { path: string; content: string; etag: string } }>(
    '/api/file',
    {
      schema: {
        body: {
          type: 'object',
          required: ['path', 'content', 'etag'],
          properties: {
            path: { type: 'string', minLength: 1 },
            content: { type: 'string' },
            etag: { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req) => files.write(req.body.path, req.body.content, req.body.etag),
  );

  app.post<{ Body: { path: string; type: 'file' | 'directory'; content?: string } }>(
    '/api/file',
    {
      schema: {
        body: {
          type: 'object',
          required: ['path', 'type'],
          properties: {
            path: { type: 'string', minLength: 1 },
            type: { type: 'string', enum: ['file', 'directory'] },
            content: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const entry = await files.create(req.body.path, req.body.type, req.body.content ?? '');
      return reply.code(201).send(entry);
    },
  );

  app.post<{ Body: { from: string; to: string } }>(
    '/api/rename',
    {
      schema: {
        body: {
          type: 'object',
          required: ['from', 'to'],
          properties: {
            from: { type: 'string', minLength: 1 },
            to: { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req) => files.rename(req.body.from, req.body.to),
  );

  app.delete<{ Querystring: PathQuery }>('/api/file', { schema: { querystring: pathQuery } }, async (req) =>
    files.remove(req.query.path),
  );

  app.get<{ Querystring: PathQuery }>('/api/versions', { schema: { querystring: pathQuery } }, async (req) => ({
    path: req.query.path,
    versions: await files.versions(req.query.path),
  }));

  // SR-1: ricerca in tutti i file (POST: la query può essere lunga o contenere caratteri speciali).
  app.post<{ Body: { query: string; regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean } }>(
    '/api/search',
    {
      schema: {
        body: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', minLength: 1, maxLength: 500 },
            regex: { type: 'boolean' },
            caseSensitive: { type: 'boolean' },
            wholeWord: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (req) => files.search(req.body),
  );

  // SR-3: sostituzione nei file indicati (quelli trovati dalla ricerca).
  app.post<{
    Body: { paths: string[]; query: string; replacement: string; regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean };
  }>(
    '/api/replace',
    {
      schema: {
        body: {
          type: 'object',
          required: ['paths', 'query', 'replacement'],
          properties: {
            paths: { type: 'array', minItems: 1, maxItems: 1000, items: { type: 'string', minLength: 1 } },
            query: { type: 'string', minLength: 1, maxLength: 500 },
            replacement: { type: 'string', maxLength: 5000 },
            regex: { type: 'boolean' },
            caseSensitive: { type: 'boolean' },
            wholeWord: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      const { paths, replacement, ...opts } = req.body;
      return files.replace(paths, opts, replacement);
    },
  );

    // FS-5: cartelle di destinazione per "Sposta in…".
  app.get('/api/folders', async () => ({ folders: await files.folders() }));

  // HA-4: chiavi di secrets.yaml per l'autocompletamento di !secret (mai i valori).
  app.get<{ Querystring: PathQuery }>('/api/secrets', { schema: { querystring: pathQuery } }, async (req) => ({
    secrets: await files.secrets(req.query.path),
  }));

  app.get<{ Querystring: { path: string; id: string } }>(
    '/api/version',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['path', 'id'],
          properties: { path: { type: 'string' }, id: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (req) => files.versionContent(req.query.path, req.query.id),
  );

  app.post<{ Body: { path: string; id: string } }>(
    '/api/restore',
    {
      schema: {
        body: {
          type: 'object',
          required: ['path', 'id'],
          properties: {
            path: { type: 'string', minLength: 1 },
            id: { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req) => files.restore(req.body.path, req.body.id),
  );

  app.post<{ Body: { from: string; to: string } }>(
    '/api/copy',
    {
      schema: {
        body: {
          type: 'object',
          required: ['from', 'to'],
          properties: {
            from: { type: 'string', minLength: 1 },
            to: { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => reply.code(201).send(await files.copy(req.body.from, req.body.to)),
  );

  // FS-6: download di un file, o di una cartella come ZIP.
  app.get<{ Querystring: PathQuery }>('/api/download', { schema: { querystring: pathQuery } }, async (req, reply) => {
    const { name, data, zip } = await files.downloadAny(req.query.path);
    return reply
      .header('Content-Type', zip ? 'application/zip' : 'application/octet-stream')
      .header('Content-Disposition', contentDisposition(name))
      .header('Cache-Control', 'no-store')
      .send(data);
  });

  // FS-6: upload dal PC; il corpo è il contenuto grezzo del file.
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  app.post<{ Querystring: { dir: string; name: string; overwrite: boolean }; Body: Buffer }>(
    '/api/upload',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['dir', 'name'],
          properties: {
            dir: { type: 'string' },
            name: { type: 'string', minLength: 1, maxLength: 255 },
            overwrite: { type: 'boolean', default: false },
          },
        },
      },
    },
    async (req, reply) => {
      if (!Buffer.isBuffer(req.body)) {
        return reply.code(400).send({ error: { code: 'invalid_request', message: 'Contenuto del file mancante' } });
      }
      const entry = await files.upload(req.query.dir, req.query.name, req.body, req.query.overwrite);
      return reply.code(201).send(entry);
    },
  );
}

/** Nome del file nel download, anche con caratteri non ASCII (RFC 6266). */
function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
