import type { FastifyInstance } from 'fastify';

/** "::ffff:172.30.32.2" → "172.30.32.2" */
export function normalizeIp(ip: string | undefined): string {
  if (!ip) return '';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

/**
 * SEC-1: accetta solo connessioni dal proxy Ingress. Usa l'indirizzo del socket,
 * non intestazioni come X-Forwarded-For che il client potrebbe falsificare.
 */
export function registerIngressGuard(app: FastifyInstance, allowedIps: readonly string[]): void {
  const allowed = new Set(allowedIps.map(normalizeIp));
  app.addHook('onRequest', async (request, reply) => {
    const ip = normalizeIp(request.raw.socket.remoteAddress);
    if (!allowed.has(ip)) {
      request.log.warn({ ip }, 'richiesta rifiutata: non proviene da Ingress');
      return reply.code(403).send({
        error: { code: 'forbidden_origin', message: 'Accesso consentito solo tramite Home Assistant' },
      });
    }
    // Una pagina di un altro sito non può far partire richieste (per esempio un riavvio) con il
    // browser dell'utente: i browser lo dicono con Sec-Fetch-Site.
    if (request.headers['sec-fetch-site'] === 'cross-site') {
      request.log.warn('richiesta rifiutata: arriva da un altro sito');
      return reply.code(403).send({
        error: { code: 'forbidden_origin', message: 'Richiesta da un altro sito rifiutata' },
      });
    }
  });
}
