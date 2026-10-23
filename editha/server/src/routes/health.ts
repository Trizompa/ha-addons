import path from 'node:path';
import { stat } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';

/**
 * Stato del server e identificativo della build dell'interfaccia: la pagina lo
 * confronta con quello letto all'avvio per accorgersi di un aggiornamento dell'app.
 */
export function registerHealthRoutes(app: FastifyInstance, webDir: string): void {
  let build: string | null = null;
  app.get('/api/health', async () => {
    if (build === null) {
      build = await stat(path.join(webDir, 'app.js')).then(
        (st) => String(Math.round(st.mtimeMs)),
        () => 'dev',
      );
    }
    return { status: 'ok', build };
  });
}
