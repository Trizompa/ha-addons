import { t } from '../i18n/index.js';

/** Percorsi relativi a /config in formato POSIX ('' = radice). */

export function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

export function join(dir: string, name: string): string {
  return dir === '' ? name : `${dir}/${name}`;
}

/**
 * Percorso relativo risolto rispetto a una cartella (come fa HA con `!include`):
 * gestisce "." e "..", null se uscirebbe da /config.
 */
export function resolvePath(dir: string, relative: string): string | null {
  // Percorso assoluto: vale solo se è dentro /config.
  const absolute = relative.startsWith('/');
  if (absolute) {
    if (relative !== '/config' && !relative.startsWith('/config/')) return null;
    relative = relative.slice('/config'.length);
  }
  const parts = absolute ? [] : dir.split('/').filter(Boolean);
  for (const part of relative.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
}

/** true se `path` coincide con `base` o sta al suo interno. */
export function isWithin(path: string, base: string): boolean {
  return base === '' || path === base || path.startsWith(base + '/');
}

/** Sostituisce il prefisso `from` con `to` (rinomina di file o cartelle). */
export function rebase(path: string, from: string, to: string): string {
  return path === from ? to : to + path.slice(from.length);
}

export function extension(path: string): string {
  const name = basename(path);
  const i = name.lastIndexOf('.');
  return i <= 0 ? '' : name.slice(i + 1).toLowerCase();
}

/** Nomi validi per file e cartelle: niente separatori, nomi speciali o caratteri di controllo. */
export function validateName(name: string): string | null {
  const n = name.trim();
  if (n === '') return t('name.empty');
  if (n === '.' || n === '..') return t('name.invalid');
  if (n.includes('/')) return t('name.slash');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(n)) return t('name.control');
  // Il limite dei nomi di file è in byte: le lettere accentate ne occupano due.
  if (new TextEncoder().encode(n).length > 255) return t('name.tooLong');
  return null;
}

/**
 * SEC-7: secrets.yaml e le sue copie (secrets_copia.yaml, secrets.yaml.bak, secret_old.yaml…).
 * Stessa regola del server (fs/search.ts).
 */
export function isSecretsFile(path: string): boolean {
  const name = basename(path);
  return (
    /^[.#~]?secrets(?![a-z])[^/]*\.ya?ml/i.test(name) ||
    /^[.#~]?secret(?:[._~ -]?(?:\d+|bak|backup|old|orig|copy|copia|new|\(\d+\)))*\.ya?ml/i.test(name)
  );
}
