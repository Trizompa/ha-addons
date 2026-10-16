import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { chmod, chown, open, rename, unlink, type FileHandle } from 'node:fs/promises';
import type { Stats } from 'node:fs';

/** Prefisso dei file temporanei, nascosti nell'albero. */
export const TEMP_PREFIX = '.editha-';

export function isTempName(name: string): boolean {
  return name.startsWith(TEMP_PREFIX) && name.endsWith('.tmp');
}

/**
 * SEC-3: scrive in un file temporaneo nella stessa cartella e lo rinomina sul file
 * di destinazione. Un'interruzione lascia il file originale intatto.
 */
export async function writeFileAtomic(target: string, data: Buffer, original?: Stats): Promise<void> {
  const dir = path.dirname(target);
  const tmp = path.join(dir, `${TEMP_PREFIX}${randomBytes(6).toString('hex')}.tmp`);
  const mode = original ? original.mode & 0o7777 : 0o644;
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
    await rename(tmp, target);
  } catch (err) {
    await handle?.close().catch(() => undefined);
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
  await syncDir(dir);
}

async function syncDir(dir: string): Promise<void> {
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
