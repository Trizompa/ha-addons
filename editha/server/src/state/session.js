import path from 'node:path';
import { JsonStore } from './json-store.js';
export const EMPTY_SESSION = { tabs: [], active: null };
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
                    // Safari, rimbalzando oltre l'inizio, può dare un valore negativo per un attimo.
                    scrollTop: { type: 'number' },
                },
                additionalProperties: false,
            },
        },
        active: { type: ['string', 'null'] },
        side: { type: ['string', 'null'] },
    },
    additionalProperties: false,
};
function isTab(t) {
    if (!t || typeof t !== 'object')
        return false;
    const r = t;
    return (typeof r.path === 'string' &&
        Number.isInteger(r.anchor) &&
        Number.isInteger(r.head) &&
        typeof r.scrollTop === 'number');
}
function sanitize(raw) {
    if (!raw || typeof raw !== 'object')
        return {};
    const r = raw;
    const tabs = Array.isArray(r.tabs) ? r.tabs.filter(isTab).slice(0, MAX_SESSION_TABS) : [];
    const active = typeof r.active === 'string' && tabs.some((t) => t.path === r.active) ? r.active : null;
    const side = typeof r.side === 'string' && tabs.some((t) => t.path === r.side) ? r.side : null;
    return side ? { tabs, active, side } : { tabs, active };
}
export function createSessionStore(dataDir) {
    return new JsonStore(path.join(dataDir, 'session.json'), EMPTY_SESSION, sanitize);
}
