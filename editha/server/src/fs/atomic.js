import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { chmod, chown, lstat, open, rename, unlink } from 'node:fs/promises';
import { EdithaError } from '../errors.js';
/** Prefisso dei file temporanei, nascosti nell'albero. */
export const TEMP_PREFIX = '.editha-';
export function isTempName(name) {
    return name.startsWith(TEMP_PREFIX) && name.endsWith('.tmp');
}
/** Stesso file, non toccato: inode, dimensione e date di modifica. */
export function sameStats(a, b) {
    return a.ino === b.ino && a.dev === b.dev && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
/**
 * SEC-3: scrive in un file temporaneo nella stessa cartella e lo rinomina sul file
 * di destinazione. Un'interruzione lascia il file originale intatto.
 */
export async function writeFileAtomic(target, data, opts = {}) {
    const { original, expect } = opts;
    const dir = path.dirname(target);
    const tmp = path.join(dir, `${TEMP_PREFIX}${randomBytes(6).toString('hex')}.tmp`);
    const mode = original ? original.mode & 0o7777 : (opts.mode ?? 0o644);
    let handle;
    try {
        handle = await open(tmp, 'wx', mode);
        await handle.writeFile(data);
        await handle.sync();
        await handle.close();
        handle = undefined;
        // open() applica l'umask: i permessi originali vanno reimpostati.
        await chmod(tmp, mode);
        if (original)
            await chown(tmp, original.uid, original.gid).catch(() => undefined);
        if (expect !== undefined)
            await checkUnchanged(target, expect);
        await rename(tmp, target);
    }
    catch (err) {
        await handle?.close().catch(() => undefined);
        await unlink(tmp).catch(() => undefined);
        throw err;
    }
    await syncDir(dir);
}
async function checkUnchanged(target, expect) {
    let now;
    try {
        now = await lstat(target);
    }
    catch (err) {
        if (err.code !== 'ENOENT')
            throw err;
        now = null;
    }
    const same = expect === null ? now === null : now !== null && sameStats(expect, now);
    if (!same)
        throw new EdithaError('conflict', 'Il file è stato modificato da un altro programma');
}
export async function syncDir(dir) {
    try {
        const handle = await open(dir, 'r');
        try {
            await handle.sync();
        }
        finally {
            await handle.close();
        }
    }
    catch {
        // Non tutti i filesystem lo supportano: la rinomina è comunque già avvenuta.
    }
}
