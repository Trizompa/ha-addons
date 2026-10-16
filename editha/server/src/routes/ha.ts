import type { FastifyInstance } from 'fastify';
import { EdithaError } from '../errors.js';
import type { CheckResult, EntityInfo, HaClient, ServiceInfo } from '../ha/client.js';

/** Piccola cache: l'autocompletamento non deve interrogare HA a ogni tasto. */
function cached<T>(ttlMs: number, load: () => Promise<T>) {
  let value: { data: T; at: number } | null = null;
  return async (fresh = false): Promise<T> => {
    if (!fresh && value && Date.now() - value.at < ttlMs) return value.data;
    value = { data: await load(), at: Date.now() };
    return value.data;
  };
}

async function requireValidConfig(ha: HaClient): Promise<CheckResult> {
  const check = await ha.checkConfig();
  if (!check.valid) {
    throw new EdithaError('config_invalid', 'La configurazione contiene errori', {
      errors: check.errors,
      warnings: check.warnings,
    });
  }
  return check;
}

export function registerHaRoutes(app: FastifyInstance, ha: HaClient): void {
  const entities = cached<EntityInfo[]>(20_000, () => ha.entities());
  const services = cached<ServiceInfo[]>(300_000, () => ha.services());
  const freshQuery = {
    type: 'object',
    properties: { fresh: { type: 'boolean', default: false } },
  } as const;

  app.get('/api/ha/status', async () => ({ available: ha.available }));

  app.get<{ Querystring: { fresh: boolean } }>('/api/ha/entities', { schema: { querystring: freshQuery } }, async (req) => ({
    entities: await entities(req.query.fresh),
  }));

  app.get<{ Querystring: { fresh: boolean } }>('/api/ha/services', { schema: { querystring: freshQuery } }, async (req) => ({
    services: await services(req.query.fresh),
  }));

  // ACT-1
  app.post('/api/ha/check', async () => ha.checkConfig());

  // Ricarica di tutta la configurazione YAML, solo se valida; l'esito è quello di HA (FEP #16).
  app.post('/api/ha/reload', async () => {
    const check = await requireValidConfig(ha);
    await ha.callService('homeassistant', 'reload_all');
    return { ok: true, warnings: check.warnings };
  });

  // ACT-4: riavvio bloccato se la verifica fallisce.
  app.post('/api/ha/restart', async () => {
    const check = await requireValidConfig(ha);
    try {
      await ha.callService('homeassistant', 'restart');
    } catch (err) {
      // Core può chiudere la connessione mentre si riavvia: la richiesta è comunque partita.
      if (!(err instanceof EdithaError && err.code === 'ha_unavailable')) throw err;
    }
    return { ok: true, warnings: check.warnings };
  });
}
