import type {
  CheckResult,
  EntityInfo,
  Entry,
  FileContent,
  SaveResult,
  ServiceInfo,
  Session,
  Settings,
  SnippetList,
  SecretKey,
  SearchResult,
  Draft,
  Version,
} from './types.js';
import { connection, isPathFailure } from './connection.js';
import { t } from '../i18n/index.js';

/** Errore restituito dal server, con il codice stabile di errors.ts. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Niente PATCH: alcuni reverse proxy davanti a Home Assistant la bloccano e il browser
// la vede come errore di rete. GET, POST, PUT e DELETE passano ovunque.
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** URL relativi: sotto Ingress la pagina vive in /api/hassio_ingress/<token>/. */
/** Corpo grezzo (upload di un file) invece di JSON. */
class RawBody {
  constructor(readonly blob: Blob) {}
}

async function send(method: Method, url: string, body: unknown): Promise<{ res: Response; data: unknown }> {
  const raw = body instanceof RawBody;
  const json = body === undefined || raw ? null : JSON.stringify(body);
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': raw ? 'application/octet-stream' : 'application/json' },
    body: body === undefined ? null : raw ? (body as RawBody).blob : json,
    cache: 'no-store',
    // Bozze e sessione inviate mentre la pagina si chiude: keepalive le porta a termine
    // (il browser lo consente solo per corpi piccoli).
    keepalive: json !== null && json.length < 60_000,
  });
  const data: unknown = await res.json().catch(() => null);
  return { res, data };
}

const offlineError = () => new ApiError(0, 'offline', t('error.offline'));

async function request<T>(method: Method, url: string, body?: unknown): Promise<T> {
  let result: { res: Response; data: unknown } | null = null;
  // Le letture si ritentano una volta: un riavvio dell'add-on dura pochi secondi.
  for (let attempt = 0; attempt < (method === 'GET' ? 2 : 1); attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 800));
    try {
      result = await send(method, url, body);
    } catch {
      result = null;
      continue;
    }
    if (!isPathFailure(result.res.status, result.data)) break;
  }
  if (!result || isPathFailure(result.res.status, result.data)) {
    connection.report(false);
    throw offlineError();
  }
  connection.report(true);
  const { res, data } = result;
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null)
      ?.error;
    throw new ApiError(res.status, err?.code ?? 'http_' + res.status, err?.message ?? res.statusText, err?.details);
  }
  return data as T;
}

const q = (path: string) => `?path=${encodeURIComponent(path)}`;

export const api = {
  tree: (path: string) => request<{ path: string; entries: Entry[] }>('GET', `api/tree${q(path)}`),
  read: (path: string) => request<FileContent>('GET', `api/file${q(path)}`),
  save: (path: string, content: string, etag: string) =>
    request<SaveResult>('PUT', 'api/file', { path, content, etag }),
  create: (path: string, type: 'file' | 'directory', content?: string) =>
    request<Entry>('POST', 'api/file', content === undefined ? { path, type } : { path, type, content }),
  rename: (from: string, to: string) => request<Entry>('POST', 'api/rename', { from, to }),
  remove: (path: string) => request<{ path: string; backup: string | null }>('DELETE', `api/file${q(path)}`),
  versions: (path: string) => request<{ path: string; versions: Version[] }>('GET', `api/versions${q(path)}`),
  version: (path: string, id: string) =>
    request<{ path: string; id: string; content: string }>('GET', `api/version${q(path)}&id=${encodeURIComponent(id)}`),
  restore: (path: string, id: string) => request<SaveResult>('POST', 'api/restore', { path, id }),
  copy: (from: string, to: string) => request<Entry>('POST', 'api/copy', { from, to }),
  settings: () => request<Settings>('GET', 'api/settings'),
  updateSettings: (changes: Partial<Settings>) => request<Settings>('POST', 'api/settings', changes),
  session: () => request<Session>('GET', 'api/session'),
  saveSession: (session: Session) => request<Session>('PUT', 'api/session', session),
  /** URL di download (file, o cartella come ZIP): il browser lo scarica sul PC. */
  downloadUrl: (path: string) => `api/download${q(path)}`,
  upload: (dir: string, name: string, file: Blob, overwrite = false) =>
    request<Entry>(
      'POST',
      `api/upload?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(name)}&overwrite=${overwrite}`,
      new RawBody(file),
    ),
  snippets: () => request<SnippetList>('GET', 'api/snippets'),
  saveSnippets: (list: SnippetList) => request<SnippetList>('PUT', 'api/snippets', list),
  search: (req: { query: string; regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean }) =>
    request<SearchResult>('POST', 'api/search', req),
  replace: (
    paths: string[],
    req: { query: string; regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean },
    replacement: string,
  ) =>
    request<{ files: { path: string; count: number; etag: string }[]; skipped: { path: string; reason: string }[] }>(
      'POST',
      'api/replace',
      { paths, replacement, ...req },
    ),
  folders: () => request<{ folders: string[] }>('GET', 'api/folders'),
  secrets: (path: string) => request<{ secrets: SecretKey[] }>('GET', `api/secrets${q(path)}`),
  drafts: () => request<{ drafts: Draft[] }>('GET', 'api/drafts'),
  saveDraft: (path: string, content: string, etag: string) =>
    request<{ path: string; savedAt: string }>('PUT', 'api/draft', { path, content, etag }),
  deleteDraft: (path: string) => request<{ path: string }>('DELETE', `api/draft${q(path)}`),
  health: () => request<{ status: string; build: string }>('GET', 'api/health'),
  ha: {
    status: () => request<{ available: boolean }>('GET', 'api/ha/status'),
    entities: (fresh = false) => request<{ entities: EntityInfo[] }>('GET', `api/ha/entities?fresh=${fresh}`),
    services: (fresh = false) => request<{ services: ServiceInfo[] }>('GET', `api/ha/services?fresh=${fresh}`),
    check: () => request<CheckResult>('POST', 'api/ha/check'),
    reload: () => request<{ ok: true; warnings: string | null }>('POST', 'api/ha/reload'),
    restart: () => request<{ ok: true; warnings: string | null }>('POST', 'api/ha/restart'),
  },
};
