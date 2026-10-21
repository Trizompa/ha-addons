import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { EdithaError, fromFsError } from './errors.js';
import { BackupStore } from './backups/store.js';
import { FileService } from './fs/files.js';
import { PathGuard } from './fs/paths.js';
import { registerIngressGuard } from './security/ingress.js';
import { registerFileRoutes } from './routes/files.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerStateRoutes } from './routes/state.js';
import { registerWebRoutes } from './routes/home.js';
import { createSessionStore } from './state/session.js';
import { createSettingsStore } from './state/settings.js';
import { createSnippetStore } from './state/snippets.js';
import { DraftStore } from './state/drafts.js';
import { HaClient } from './ha/client.js';
import { GitService } from './git/git.js';
import { registerGitRoutes } from './routes/git.js';
import { registerHaRoutes } from './routes/ha.js';

export interface AppOptions {
  /** false nei test per non sporcare l'output. */
  logger?: boolean;
}

export async function buildApp(config: Config, options: AppOptions = {}): Promise<FastifyInstance> {
  const guard = await PathGuard.create(config.configDir);
  const backupDir = path.join(config.dataDir, 'backups');
  await mkdir(backupDir, { recursive: true });
  const files = new FileService(
    guard,
    new BackupStore(backupDir, config.backupKeep),
    config.maxFileSize,
    config.maxTransfer,
  );

  const app = Fastify({
    // SEC-9: il logger di Fastify registra metodo, URL ed esito, mai i corpi delle richieste.
    logger: options.logger === false ? false : { level: config.logLevel },
    // Margine per JSON ed escape oltre al contenuto del file.
    bodyLimit: Math.max(config.maxFileSize * 2 + 64 * 1024, config.maxTransfer + 64 * 1024),
    // Campi sconosciuti rifiutati, non scartati in silenzio; niente conversioni di tipo
    // (con quelle un `content: null` diventerebbe un file vuoto).
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });

  registerIngressGuard(app, config.allowedIps);

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof EdithaError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const e = err as { validation?: unknown; statusCode?: number; message?: string };
    if (e.validation || e.statusCode === 400) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: e.message } });
    }
    if (e.statusCode === 413) {
      return reply.code(413).send({ error: { code: 'too_large', message: e.message } });
    }
    // Altri errori della richiesta (es. tipo di contenuto non supportato): restano 4xx.
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: { code: 'invalid_request', message: e.message } });
    }
    // Errori del filesystem non previsti altrove (permessi, disco pieno…).
    const mapped = fromFsError(err, '');
    if (mapped instanceof EdithaError) {
      return reply.code(mapped.status).send({ error: { code: mapped.code, message: mapped.message } });
    }
    request.log.error({ err }, 'errore non gestito');
    return reply.code(500).send({ error: { code: 'internal', message: 'Errore interno' } });
  });

  registerHealthRoutes(app, config.webDir);
  registerFileRoutes(app, files);
  registerStateRoutes(
    app,
    createSettingsStore(config.dataDir),
    createSessionStore(config.dataDir),
    createSnippetStore(config.dataDir),
    new DraftStore(path.join(config.dataDir, 'drafts')),
    config.maxFileSize,
    (p) => files.isSecrets(p),
  );
  registerGitRoutes(app, new GitService(config.configDir, path.join(config.dataDir, 'git-home'), config.maxFileSize));
  registerHaRoutes(app, new HaClient(config.haUrl, config.haToken), (p) => files.isSecrets(p));
  await registerWebRoutes(app, config.webDir);
  return app;
}
