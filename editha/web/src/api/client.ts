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
  ListedDraft,
  Version,
} from './types.js';
import { connection, isPathFailure } from './connection.js';
import { getLang, t, type MessageKey } from '../i18n/index.js';

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

/**
 * Richieste partite mentre la pagina si chiude (bozze, sessione): solo queste usano keepalive,
 * che il browser concede a corpi piccoli (64 KB in tutto). Un salvataggio normale non deve
 * passare di lì, altrimenti un file grande fallirebbe come se Editha non rispondesse.
 */
let leaving = false;

/** Esegue `send` (sincrono fino alla fetch) segnando le richieste come "in uscita". */
export function whileLeaving(send: () => void): void {
  leaving = true;
  try {
    send();
  } finally {
    leaving = false;
  }
}

async function send(method: Method, url: string, body: unknown): Promise<{ res: Response; data: unknown }> {
  const raw = body instanceof RawBody;
  const json = body === undefined || raw ? null : JSON.stringify(body);
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': raw ? 'application/octet-stream' : 'application/json' },
    body: body === undefined ? null : raw ? (body as RawBody).blob : json,
    cache: 'no-store',
    keepalive: leaving && !raw && (json === null || new TextEncoder().encode(json).length < 60_000),
  });
  const data: unknown = await res.json().catch(() => null);
  return { res, data };
}

const offlineError = () => new ApiError(0, 'offline', t('error.offline'));

/** Testo di un errore per l'utente: i messaggi del server sono in italiano, le altre lingue usano il codice. */
export function errorText(err: unknown): string {
  if (!(err instanceof ApiError)) return t('error.unexpected');
  if (getLang() === 'it' || err.code === 'offline') return err.message;
  const key = `error.${err.code}` as MessageKey;
  const translated = t(key);
  return translated === key ? err.message : translated;
}

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

/**
 * Identità di questa finestra per le bozze: resta uguale ricaricando la pagina, così le bozze
 * lasciate dal caricamento precedente si riconoscono come proprie. In sessionStorage (che è per
 * scheda) la si tiene solo mentre la pagina si chiude: una scheda duplicata, che ne copia il
 * contenuto, così ne riceve una nuova invece di condividerla.
 */
export const CLIENT_ID: string = (() => {
  let id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  try {
    const saved = sessionStorage.getItem('editha.client');
    if (saved) id = saved;
    sessionStorage.removeItem('editha.client');
  } catch {
    // Senza sessionStorage (navigazione privata rigida): un'identità nuova a ogni caricamento.
  }
  return id;
})();

/** Pagina di nuovo attiva (ripresa dalla cache del browser): l'identità non resta in sessionStorage. */
export function forgetKeptClientId(): void {
  try {
    sessionStorage.removeItem('editha.client');
  } catch {
    // vedi sopra
  }
}

/** Da chiamare mentre la pagina si chiude: il prossimo caricamento di questa scheda la ritrova. */
export function keepClientId(): void {
  try {
    sessionStorage.setItem('editha.client', CLIENT_ID);
  } catch {
    // vedi sopra
  }
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
  /** Senza `noBackup` il server rifiuta (no_backup) ciò di cui non può tenere una copia. */
  remove: (path: string, noBackup = false) =>
    request<{ path: string; backup: string | null }>('DELETE', `api/file${q(path)}${noBackup ? '&noBackup=true' : ''}`),
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
  /** FS-10: URL dell'anteprima di un'immagine o di un PDF. */
  previewUrl: (path: string) => `api/preview${q(path)}`,
  upload: (dir: string, name: string, file: Blob, overwrite = false, noBackup = false) =>
    request<Entry & { backup?: string | null }>(
      'POST',
      `api/upload?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(name)}&overwrite=${overwrite}` +
        (noBackup ? '&noBackup=true' : ''),
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
  drafts: () => request<{ drafts: ListedDraft[] }>('GET', 'api/drafts'),
  /** Bozza di questa finestra. */
  saveDraft: (path: string, content: string, etag: string) =>
    request<{ path: string; savedAt: string }>('PUT', 'api/draft', { path, content, etag, client: CLIENT_ID }),
  /** Senza `client` si elimina la bozza di questa finestra; `null`: bozza di una versione precedente. */
  deleteDraft: (path: string, client: string | null | undefined = CLIENT_ID) =>
    request<{ path: string }>('DELETE', `api/draft${q(path)}${client ? `&client=${encodeURIComponent(client)}` : ''}`),
  /** Prende per questa finestra la bozza di un'altra: `claimed` false se l'ha già presa un'altra. */
  claimDraft: (path: string, from: string | undefined) =>
    request<{ claimed: boolean; draft?: Draft }>('POST', 'api/draft/claim', {
      path,
      ...(from ? { from } : {}),
      client: CLIENT_ID,
    }),
  /** Questa finestra è ancora aperta (`closing`: si sta chiudendo). */
  draftsAlive: (closing = false) =>
    request<{ ok: true }>('POST', 'api/drafts/alive', { client: CLIENT_ID, ...(closing ? { closing } : {}) }),
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
