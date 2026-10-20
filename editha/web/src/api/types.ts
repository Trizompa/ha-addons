// Tipi condivisi con il server (D1): una sola definizione per entrambi i lati.
export type {
  Entry,
  EntryType,
  FileContent,
  SaveResult,
  SearchMatch,
  SearchResult,
  SecretKey,
} from '../../../server/src/fs/files.js';
export type { Version } from '../../../server/src/backups/store.js';
export type { Settings, ThemeMode } from '../../../server/src/state/settings.js';
export type { Session, SessionTab } from '../../../server/src/state/session.js';
export type { CheckResult, EntityInfo, ServiceInfo } from '../../../server/src/ha/client.js';
export type { Snippet, SnippetList } from '../../../server/src/state/snippets.js';
export type { Draft, ListedDraft } from '../../../server/src/state/drafts.js';
