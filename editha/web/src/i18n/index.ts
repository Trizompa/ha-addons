import { it, type Dictionary } from './it.js';
import { en } from './en.js';

export type Lang = 'it' | 'en';
export type LanguageSetting = 'auto' | Lang;
export type MessageKey = keyof Dictionary;

const DICTIONARIES: Record<Lang, Dictionary> = { it, en };

let current: Lang = 'it';
const listeners = new Set<() => void>();

/** Lingua del browser: italiano se il browser è in italiano, altrimenti inglese. */
export function detectLang(languages: readonly string[] = navigator.languages ?? [navigator.language]): Lang {
  return languages.some((l) => l.toLowerCase().startsWith('it')) ? 'it' : 'en';
}

export function resolveLang(setting: LanguageSetting): Lang {
  return setting === 'auto' ? detectLang() : setting;
}

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  for (const fn of listeners) fn();
}

export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Testo tradotto; {nome} nel testo viene sostituito con params.nome. */
export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  const text: string = DICTIONARIES[current][key] ?? it[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

/** Per i test: dizionario di una lingua. */
export function dictionary(lang: Lang): Dictionary {
  return DICTIONARIES[lang];
}
