import path from 'node:path';
import { JsonStore } from './json-store.js';

export type ThemeMode = 'auto' | 'light' | 'dark';
export type LanguageSetting = 'auto' | 'it' | 'en';

/** Impostazioni dell'interfaccia (CFG-1): un'unica fonte, in /data. */
export interface Settings {
  theme: ThemeMode;
  sidebarVisible: boolean;
  sidebarWidth: number;
  wordWrap: boolean;
  fontSize: number;
  /** Mostra nell'albero le cartelle di sistema in sola lettura (SEC-8). */
  showSystem: boolean;
  /** Lingua dell'interfaccia; "auto" segue il browser. */
  language: LanguageSetting;
  /** Schema del file aperto a fianco dell'editor (ED-18). */
  outlineVisible: boolean;
  /** Aiuti di Home Assistant: attributi e stati nei suggerimenti, avviso per le entità sconosciute. */
  haHints: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  sidebarVisible: true,
  sidebarWidth: 280,
  wordWrap: false,
  fontSize: 14,
  showSystem: false,
  language: 'auto',
  outlineVisible: false,
  haHints: true,
};

/** Schema JSON condiviso da validazione delle richieste e lettura da disco. */
export const settingsSchema = {
  type: 'object',
  properties: {
    theme: { type: 'string', enum: ['auto', 'light', 'dark'] },
    sidebarVisible: { type: 'boolean' },
    sidebarWidth: { type: 'integer', minimum: 160, maximum: 640 },
    wordWrap: { type: 'boolean' },
    fontSize: { type: 'integer', minimum: 10, maximum: 24 },
    showSystem: { type: 'boolean' },
    language: { type: 'string', enum: ['auto', 'it', 'en'] },
    outlineVisible: { type: 'boolean' },
    haHints: { type: 'boolean' },
  },
  additionalProperties: false,
} as const;

function sanitize(raw: unknown): Partial<Settings> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<Settings> = {};
  if (r.theme === 'auto' || r.theme === 'light' || r.theme === 'dark') out.theme = r.theme;
  if (typeof r.sidebarVisible === 'boolean') out.sidebarVisible = r.sidebarVisible;
  if (Number.isInteger(r.sidebarWidth) && (r.sidebarWidth as number) >= 160 && (r.sidebarWidth as number) <= 640) {
    out.sidebarWidth = r.sidebarWidth as number;
  }
  if (typeof r.wordWrap === 'boolean') out.wordWrap = r.wordWrap;
  if (Number.isInteger(r.fontSize) && (r.fontSize as number) >= 10 && (r.fontSize as number) <= 24) {
    out.fontSize = r.fontSize as number;
  }
  if (typeof r.showSystem === 'boolean') out.showSystem = r.showSystem;
  if (r.language === 'auto' || r.language === 'it' || r.language === 'en') out.language = r.language;
  if (typeof r.outlineVisible === 'boolean') out.outlineVisible = r.outlineVisible;
  if (typeof r.haHints === 'boolean') out.haHints = r.haHints;
  return out;
}

export function createSettingsStore(dataDir: string): JsonStore<Settings> {
  return new JsonStore(path.join(dataDir, 'settings.json'), DEFAULT_SETTINGS, sanitize);
}
