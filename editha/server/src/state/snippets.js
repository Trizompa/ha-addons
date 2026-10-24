import path from 'node:path';
import { JsonStore } from './json-store.js';
export const MAX_SNIPPETS = 200;
export const snippetsSchema = {
    type: 'object',
    required: ['snippets'],
    properties: {
        snippets: {
            type: 'array',
            maxItems: MAX_SNIPPETS,
            items: {
                type: 'object',
                required: ['id', 'name', 'body'],
                properties: {
                    id: { type: 'string', minLength: 1, maxLength: 64 },
                    name: { type: 'string', minLength: 1, maxLength: 120 },
                    body: { type: 'string', maxLength: 20000 },
                },
                additionalProperties: false,
            },
        },
    },
    additionalProperties: false,
};
function isSnippet(s) {
    if (!s || typeof s !== 'object')
        return false;
    const r = s;
    return typeof r.id === 'string' && typeof r.name === 'string' && typeof r.body === 'string';
}
function sanitize(raw) {
    if (!raw || typeof raw !== 'object')
        return {};
    const list = raw.snippets;
    return { snippets: Array.isArray(list) ? list.filter(isSnippet).slice(0, MAX_SNIPPETS) : [] };
}
export function createSnippetStore(dataDir) {
    return new JsonStore(path.join(dataDir, 'snippets.json'), { snippets: [] }, sanitize);
}
