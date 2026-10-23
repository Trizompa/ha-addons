import path from 'node:path';
import { access } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

const PLACEHOLDER = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Editha</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; margin: 0; padding: 32px 16px; max-width: 40rem; }
</style>
</head>
<body>
<h1>Editha</h1>
<p>Il server è attivo, ma l'interfaccia non è stata compilata.</p>
</body>
</html>
`;

/**
 * Serve l'interfaccia compilata. Gli URL sono relativi: sotto Ingress la pagina vive
 * in /api/hassio_ingress/<token>/ e il proxy toglie il prefisso.
 */
export async function registerWebRoutes(app: FastifyInstance, webDir: string): Promise<void> {
  try {
    await access(path.join(webDir, 'index.html'));
  } catch {
    app.log.warn({ webDir }, 'interfaccia non trovata: servo una pagina provvisoria');
    app.get('/', async (_req, reply) => reply.type('text/html; charset=utf-8').send(PLACEHOLDER));
    return;
  }
  await app.register(fastifyStatic, {
    root: webDir,
    prefix: '/',
    // La pagina principale ha una rotta esplicita: con preCompressed l'indice automatico
    // risponde 404 ai browser che chiedono contenuti compressi.
    index: false,
    wildcard: false,
    preCompressed: true,
    // Nessuna cache a lungo termine: dopo un aggiornamento dell'app serve la nuova versione.
    cacheControl: false,
    setHeaders: (res) => {
      res.header('Cache-Control', 'no-cache');
    },
  });
  // La pagina non va mai presa dalla cache: contiene il riferimento alla build corrente.
  app.get('/', (_req, reply) => reply.header('Cache-Control', 'no-cache').sendFile('index.html'));
}
