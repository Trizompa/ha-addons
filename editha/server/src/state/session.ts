import path from 'node:path';
import { JsonStore } from './json-store.js';

export interface SessionTab {
  path: string;
  /** Selezione principale, come posizioni nel documento. */
  anchor: number;
  head: number;
  scrollTop: number;
}

/** Tab aperte e tab attiva, per ritrovarle rientrando (ED-11, FEP #13). */
export interface Session {
  tabs: SessionTab[];
  active: string | null;
  /** ED-17: file mostrato nella colonna destra della vista divisa (assente = vista singola). */
  side?: string | null;
}

export const EMPTY_SESSION: Session = { tabs: [], active: null };

export const MAX_SESSION_TABS = 50;

export const sessionSchema = {
  type: 'object',
  required: ['tabs', 'active'],
  properties: {
    tabs: {
      type: 'array',
      maxItems: MAX_SESSION_TABS,
      items: {
        type: 'object',
        required: ['path', 'anchor', 'head', 'scrollTop'],
        properties: {
          path: { type: 'string', minLength: 1, maxLength: 4096 },
          anchor: { type: 'integer', minimum: 0 },
          head: { type: 'integer', minimum: 0 },
          scrollTop: { type: 'number', minimum: 0 },
        },
        additionalProperties: false,
      },
    },
    active: { type: ['string', 'null'] },
    side: { type: ['string', 'null'] },
  },
  additionalProperties: false,
} as const;

function isTab(t: unknown): t is SessionTab {
  if (!t || typeof t !== 'object') return false;
  const r = t as Record<string, unknown>;
  return (
    typeof r.path === 'string' &&
    Number.isInteger(r.anchor) &&
    Number.isInteger(r.head) &&
    typeof r.scrollTop === 'number'
  );
}

function sanitize(raw: unknown): Partial<Session> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const tabs = Array.isArray(r.tabs) ? r.tabs.filter(isTab).slice(0, MAX_SESSION_TABS) : [];
  const active = typeof r.active === 'string' && tabs.some((t) => t.path === r.active) ? r.active : null;
  const side = typeof r.side === 'string' && tabs.some((t) => t.path === r.side) ? r.side : null;
  return side ? { tabs, active, side } : { tabs, active };
}

export function createSessionStore(dataDir: string): JsonStore<Session> {
  return new JsonStore(path.join(dataDir, 'session.json'), EMPTY_SESSION, sanitize);
}
