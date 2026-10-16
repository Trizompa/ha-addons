import { EdithaError } from '../errors.js';

export interface EntityInfo {
  entity_id: string;
  name: string;
  state: string;
  unit: string | null;
}

export interface ServiceInfo {
  /** "domain.service" */
  id: string;
  name: string;
  description: string;
}

export interface CheckResult {
  valid: boolean;
  errors: string | null;
  warnings: string | null;
}

interface HaState {
  entity_id: string;
  state: string;
  attributes?: { friendly_name?: unknown; unit_of_measurement?: unknown };
}

interface HaServiceDomain {
  domain: string;
  services: Record<string, { name?: unknown; description?: unknown }>;
}

const TIMEOUT_MS = 15_000;
/** Il controllo della configurazione può richiedere più tempo su installazioni grandi. */
const CHECK_TIMEOUT_MS = 120_000;

/**
 * Chiamate alle API REST di Home Assistant Core tramite il proxy del Supervisor.
 * Il token resta sul server: il browser non lo vede mai (SEC-6).
 */
export class HaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  get available(): boolean {
    return this.token !== '';
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeout = TIMEOUT_MS): Promise<T> {
    if (!this.available) {
      throw new EdithaError('ha_unavailable', 'Home Assistant non è raggiungibile da questa installazione');
    }
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? null : JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (err) {
      const timedOut = (err as Error | undefined)?.name === 'TimeoutError';
      throw new EdithaError(
        'ha_unavailable',
        timedOut ? 'Home Assistant non ha risposto in tempo' : 'Impossibile contattare Home Assistant',
      );
    }
    const text = await res.text();
    if (!res.ok) {
      throw new EdithaError('ha_error', `Home Assistant ha risposto con un errore (${res.status})`, {
        status: res.status,
        message: text.slice(0, 500),
      });
    }
    try {
      return (text ? JSON.parse(text) : null) as T;
    } catch {
      throw new EdithaError('ha_error', 'Risposta di Home Assistant non valida');
    }
  }

  async entities(): Promise<EntityInfo[]> {
    const states = await this.call<HaState[]>('GET', '/states');
    return states
      .map((s) => ({
        entity_id: s.entity_id,
        name: typeof s.attributes?.friendly_name === 'string' ? s.attributes.friendly_name : '',
        state: s.state,
        unit: typeof s.attributes?.unit_of_measurement === 'string' ? s.attributes.unit_of_measurement : null,
      }))
      .sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  }

  async services(): Promise<ServiceInfo[]> {
    const domains = await this.call<HaServiceDomain[]>('GET', '/services');
    const out: ServiceInfo[] = [];
    for (const d of domains) {
      for (const [name, info] of Object.entries(d.services ?? {})) {
        out.push({
          id: `${d.domain}.${name}`,
          name: typeof info.name === 'string' ? info.name : '',
          description: typeof info.description === 'string' ? info.description : '',
        });
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  /** ACT-1: lo stesso controllo di "Verifica configurazione" in HA. */
  async checkConfig(): Promise<CheckResult> {
    const res = await this.call<{ result?: string; errors?: string | null; warnings?: string | null }>(
      'POST',
      '/config/core/check_config',
      undefined,
      CHECK_TIMEOUT_MS,
    );
    return {
      valid: res?.result === 'valid',
      errors: res?.errors || null,
      warnings: res?.warnings || null,
    };
  }

  async callService(domain: string, service: string, data: Record<string, unknown> = {}): Promise<void> {
    await this.call('POST', `/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`, data);
  }
}
