import path from 'node:path';
import { JsonStore } from './json-store.js';

export interface Snippet {
  id: string;
  name: string;
  body: string;
}

/** Snippet personali dell'utente, in /data (quelli predefiniti stanno nell'interfaccia). */
export interface SnippetList {
  snippets: Snippet[];
}

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
} as const;

function isSnippet(s: unknown): s is Snippet {
  if (!s || typeof s !== 'object') return false;
  const r = s as Record<string, unknown>;
  return typeof r.id === 'string' && typeof r.name === 'string' && typeof r.body === 'string';
}

function sanitize(raw: unknown): Partial<SnippetList> {
  if (!raw || typeof raw !== 'object') return {};
  const list = (raw as Record<string, unknown>).snippets;
  return { snippets: Array.isArray(list) ? list.filter(isSnippet).slice(0, MAX_SNIPPETS) : [] };
}

export function createSnippetStore(dataDir: string): JsonStore<SnippetList> {
  return new JsonStore(path.join(dataDir, 'snippets.json'), { snippets: [] }, sanitize);
}
