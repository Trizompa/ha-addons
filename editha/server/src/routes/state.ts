import type { FastifyInstance } from 'fastify';
import type { JsonStore } from '../state/json-store.js';
import { sessionSchema, type Session } from '../state/session.js';
import { settingsSchema, type Settings } from '../state/settings.js';
import { snippetsSchema, type SnippetList } from '../state/snippets.js';
import { aliveSchema, draftSchema, type DraftStore } from '../state/drafts.js';
import { EdithaError } from '../errors.js';

export function registerStateRoutes(
  app: FastifyInstance,
  settings: JsonStore<Settings>,
  session: JsonStore<Session>,
  snippets: JsonStore<SnippetList>,
  drafts: DraftStore,
  maxDraftSize: number,
): void {
  app.get('/api/settings', async () => settings.get());

  // POST e non PATCH: alcuni reverse proxy davanti a Home Assistant bloccano PATCH.
  app.post<{ Body: Partial<Settings> }>('/api/settings', { schema: { body: settingsSchema } }, async (req) =>
    settings.patch(req.body),
  );

  app.get('/api/session', async () => session.get());

  app.put<{ Body: Session }>('/api/session', { schema: { body: sessionSchema } }, async (req) =>
    session.set(req.body),
  );

  app.get('/api/snippets', async () => snippets.get());

  app.put<{ Body: SnippetList }>('/api/snippets', { schema: { body: snippetsSchema } }, async (req) =>
    snippets.set(req.body),
  );

  // ED-14: bozze delle modifiche non salvate.
  app.get('/api/drafts', async () => ({ drafts: await drafts.list() }));

  app.put<{ Body: { path: string; content: string; etag: string; client?: string } }>(
    '/api/draft',
    { schema: { body: draftSchema } },
    async (req) => {
      const size = Buffer.byteLength(req.body.content, 'utf8');
      if (size > maxDraftSize) {
        throw new EdithaError('too_large', `Bozza troppo grande (${size} byte)`, { size, limit: maxDraftSize });
      }
      const draft = await drafts.put(req.body.path, req.body.content, req.body.etag, req.body.client);
      return { path: draft.path, savedAt: draft.savedAt };
    },
  );

  app.delete<{ Querystring: { path: string; client?: string } }>(
    '/api/draft',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['path'],
          properties: { path: { type: 'string' }, client: { type: 'string', minLength: 1, maxLength: 64 } },
        },
      },
    },
    async (req) => {
      await drafts.remove(req.query.path, req.query.client);
      return { path: req.query.path };
    },
  );

  // Una finestra aperta lo segnala ogni tanto: le sue bozze non vanno proposte a un'altra.
  app.post<{ Body: { client: string; closing?: boolean } }>(
    '/api/drafts/alive',
    { schema: { body: aliveSchema } },
    async (req) => {
      drafts.alive(req.body.client, req.body.closing === true);
      return { ok: true };
    },
  );
}
