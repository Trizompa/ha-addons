import type { FastifyInstance } from 'fastify';
import type { GitService } from '../git/git.js';

/** Git locale in /config (GIT-1…6). Nessun comando di rete: niente push, pull o fetch. */
export function registerGitRoutes(app: FastifyInstance, git: GitService): void {
  app.get('/api/git/info', async () => git.info());

  // GIT-1: nuovo repository con il .gitignore di base.
  app.post('/api/git/init', async (req) => {
    const res = await git.init();
    req.log.info({ gitignoreCreated: res.gitignoreCreated }, 'git: repository creato in /config');
    return res;
  });

  // GIT-2: stato dei file, calcolato a richiesta.
  app.get('/api/git/status', async () => git.status());

  // GIT-4: commit di tutti i file cambiati o di quelli scelti (mai secrets.yaml e copie).
  app.post<{ Body: { message: string; paths?: string[]; all?: boolean } }>(
    '/api/git/commit',
    {
      schema: {
        body: {
          type: 'object',
          required: ['message'],
          properties: {
            message: { type: 'string', minLength: 1, maxLength: 5000, pattern: '\\S' },
            paths: { type: 'array', minItems: 1, maxItems: 5000, items: { type: 'string', minLength: 1, maxLength: 4096 } },
            all: { type: 'boolean', const: true },
          },
          additionalProperties: false,
          oneOf: [{ required: ['paths'] }, { required: ['all'] }],
        },
      },
    },
    async (req) => {
      const res = await git.commit(req.body.message, req.body.all ? 'all' : req.body.paths!);
      req.log.info({ hash: res.hash.slice(0, 12), files: res.files, skipped: res.skipped }, 'git: commit creato');
      return res;
    },
  );

  // GIT-3: il file com'era nell'ultimo commit, da confrontare con quello attuale.
  app.get<{ Querystring: { path: string } }>(
    '/api/git/head',
    { schema: { querystring: { type: 'object', required: ['path'], properties: { path: { type: 'string', minLength: 1, maxLength: 4096 } } } } },
    async (req) => git.contentAt(req.query.path),
  );

  // GIT-6: il file com'era in un commit qualsiasi (per confrontarlo o ripristinarlo).
  app.get<{ Querystring: { path: string; rev: string } }>(
    '/api/git/show',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['path', 'rev'],
          properties: { path: { type: 'string', minLength: 1, maxLength: 4096 }, rev: { type: 'string', pattern: '^[0-9a-f]{4,64}$' } },
        },
      },
    },
    async (req) => git.contentAt(req.query.path, req.query.rev),
  );

  // GIT-5: elenco dei commit e file toccati da ciascuno.
  // Nell'URL i numeri sono testo.
  app.get<{ Querystring: { skip?: string } }>(
    '/api/git/log',
    { schema: { querystring: { type: 'object', properties: { skip: { type: 'string', pattern: '^[0-9]{1,7}$' } } } } },
    async (req) => git.log(Number(req.query.skip ?? 0)),
  );
  app.get<{ Querystring: { rev: string } }>(
    '/api/git/commit-files',
    { schema: { querystring: { type: 'object', required: ['rev'], properties: { rev: { type: 'string', pattern: '^[0-9a-f]{4,64}$' } } } } },
    async (req) => git.commitFiles(req.query.rev),
  );

  // .gitignore di base in un repository che non ce l'ha; quello esistente non si tocca.
  app.post('/api/git/gitignore', async () => ({ created: await git.writeGitignore(), info: await git.info() }));
}
