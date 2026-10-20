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

  // .gitignore di base in un repository che non ce l'ha; quello esistente non si tocca.
  app.post('/api/git/gitignore', async () => ({ created: await git.writeGitignore(), info: await git.info() }));
}
