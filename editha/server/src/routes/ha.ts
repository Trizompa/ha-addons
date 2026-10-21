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

export function registerHaRoutes(
  app: FastifyInstance,
  ha: HaClient,
  isSecrets: (path: string) => Promise<boolean> = async () => false,
): void {
  const entities = cached<EntityInfo[]>(20_000, () => ha.entities());
  const services = cached<ServiceInfo[]>(300_000, () => ha.services());
  // Nell'URL i valori sono testo: "true" o "false".
  const freshQuery = {
    type: 'object',
    properties: { fresh: { type: 'string', enum: ['true', 'false'], default: 'false' } },
  } as const;

  app.get('/api/ha/status', async () => ({ available: ha.available }));

  app.get<{ Querystring: { fresh: string } }>('/api/ha/entities', { schema: { querystring: freshQuery } }, async (req) => ({
    entities: await entities(req.query.fresh === 'true'),
  }));

  app.get<{ Querystring: { fresh: string } }>('/api/ha/services', { schema: { querystring: freshQuery } }, async (req) => ({
    services: await services(req.query.fresh === 'true'),
  }));

  // HA-7: anteprima di un template. Arriva solo il testo del template, mai il file intero
  // (salvo i file .jinja); da secrets.yaml e dalle sue copie non parte niente (SEC-7), e un testo
  // senza {{ }}, {% %} o {# #} non è un template: non si manda.
  app.post<{ Body: { template: string; path?: string } }>(
    '/api/ha/template',
    {
      schema: {
        body: {
          type: 'object',
          required: ['template'],
          properties: {
            template: { type: 'string', minLength: 1, maxLength: 50_000 },
            path: { type: 'string', maxLength: 4096 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      if (!/\{\{|\{%|\{#/.test(req.body.template)) throw new EdithaError('invalid_request', 'Nessun template');
      if (req.body.path !== undefined && (await isSecrets(req.body.path))) {
        throw new EdithaError('forbidden_path', 'Anteprima non disponibile per secrets.yaml');
      }
      return ha.renderTemplate(req.body.template);
    },
  );

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
      // Core può chiudere la connessione mentre si riavvia (e il proxy del Supervisor risponde
      // 502/503/504): la richiesta è comunque partita.
      const status = err instanceof EdithaError ? (err.details as { status?: number } | undefined)?.status : undefined;
      const dropped = err instanceof EdithaError && (err.code === 'ha_unavailable' || (err.code === 'ha_error' && [502, 503, 504].includes(status ?? 0)));
      if (!dropped) throw err;
    }
    return { ok: true, warnings: check.warnings };
  });
}
