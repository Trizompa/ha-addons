import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { chmod, chown, lstat, open, rename, unlink, type FileHandle } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { EdithaError } from '../errors.js';

/** Prefisso dei file temporanei, nascosti nell'albero. */
export const TEMP_PREFIX = '.editha-';

export function isTempName(name: string): boolean {
  return name.startsWith(TEMP_PREFIX) && name.endsWith('.tmp');
}

export interface AtomicOptions {
  /** File sostituito: se ne tengono permessi e proprietario. */
  original?: Stats | undefined;
  /** Permessi del file nuovo quando non c'è `original` (predefinito 0644). */
  mode?: number | undefined;
  /**
   * Stato del file preso sotto il lock (null = non deve esistere). Appena prima della
   * rinomina si ricontrolla: se un altro programma l'ha cambiato nel frattempo si
   * rinuncia con `conflict` invece di sovrascriverlo.
   */
  expect?: Stats | null | undefined;
}

/** Stesso file, non toccato: inode, dimensione e date di modifica. */
export function sameStats(a: Stats, b: Stats): boolean {
  return a.ino === b.ino && a.dev === b.dev && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

/**
 * SEC-3: scrive in un file temporaneo nella stessa cartella e lo rinomina sul file
 * di destinazione. Un'interruzione lascia il file originale intatto.
 */
export async function writeFileAtomic(target: string, data: Buffer, opts: AtomicOptions = {}): Promise<void> {
  const { original, expect } = opts;
  const dir = path.dirname(target);
  const tmp = path.join(dir, `${TEMP_PREFIX}${randomBytes(6).toString('hex')}.tmp`);
  const mode = original ? original.mode & 0o7777 : (opts.mode ?? 0o644);
  let handle: FileHandle | undefined;
  try {
    handle = await open(tmp, 'wx', mode);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    // open() applica l'umask: i permessi originali vanno reimpostati.
    await chmod(tmp, mode);
    if (original) await chown(tmp, original.uid, original.gid).catch(() => undefined);
    if (expect !== undefined) await checkUnchanged(target, expect);
    await rename(tmp, target);
  } catch (err) {
    await handle?.close().catch(() => undefined);
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
  await syncDir(dir);
}

async function checkUnchanged(target: string, expect: Stats | null): Promise<void> {
  let now: Stats | null;
  try {
    now = await lstat(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    now = null;
  }
  const same = expect === null ? now === null : now !== null && sameStats(expect, now);
  if (!same) throw new EdithaError('conflict', 'Il file è stato modificato da un altro programma');
}

export async function syncDir(dir: string): Promise<void> {
  try {
    const handle = await open(dir, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Non tutti i filesystem lo supportano: la rinomina è comunque già avvenuta.
  }
}
