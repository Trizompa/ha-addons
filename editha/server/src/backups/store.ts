import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import type { Stats } from 'node:fs';
import { copyFile, cp, mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { syncDir, writeFileAtomic } from '../fs/atomic.js';
import { KeyedLock } from '../fs/lock.js';

export type BackupReason = 'save' | 'delete' | 'restore';

export interface Version {
  /** Identificativo ordinabile, es. "20261015T064156123Z-save". */
  id: string;
  reason: BackupReason;
  createdAt: string;
  kind: 'file' | 'directory';
  size: number;
}

// Il suffisso ".N" c'è solo nelle versioni create dalle versioni precedenti di Editha.
const VERSION_RE = /^(\d{8}T\d{9}Z)(?:\.(\d+))?-(save|delete|restore)$/;
const INDEX_FILE = 'index.json';
/** Versione in scrittura: non ha la forma di un id, quindi non compare mai nell'elenco. */
const TEMP_RE = /^\.tmp-/;

function compactTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:.]/g, '');
}

function parseTimestamp(ts: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/.exec(ts);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7]}Z` : ts;
}

/** Ordine cronologico degli id: per data e poi per suffisso numerico (".10" dopo ".2"). */
function compareIds(a: string, b: string): number {
  const ma = VERSION_RE.exec(a)!;
  const mb = VERSION_RE.exec(b)!;
  if (ma[1] !== mb[1]) return ma[1]! < mb[1]! ? -1 : 1;
  return Number(ma[2] ?? -1) - Number(mb[2] ?? -1);
}

/** Stesso contenuto di due file, letto a pezzi (niente file interi in memoria). */
async function sameFileContent(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([open(a, 'r'), open(b, 'r')]);
  try {
    const [sa, sb] = await Promise.all([ha.stat(), hb.stat()]);
    if (sa.size !== sb.size) return false;
    const bufA = Buffer.alloc(64 * 1024);
    const bufB = Buffer.alloc(64 * 1024);
    for (;;) {
      const [ra, rb] = await Promise.all([ha.read(bufA, 0, bufA.length, null), hb.read(bufB, 0, bufB.length, null)]);
      if (ra.bytesRead !== rb.bytesRead) return false;
      if (ra.bytesRead === 0) return true;
      if (!bufA.subarray(0, ra.bytesRead).equals(bufB.subarray(0, rb.bytesRead))) return false;
    }
  } finally {
    await Promise.all([ha.close(), hb.close()]);
  }
}

/** fsync di un file, o di una cartella con tutto il contenuto (link esclusi). */
async function syncTree(target: string): Promise<void> {
  const st = await stat(target);
  if (st.isDirectory()) {
    for (const d of await readdir(target, { withFileTypes: true })) {
      if (d.isDirectory() || d.isFile()) await syncTree(path.join(target, d.name));
    }
    await syncDir(target);
  } else if (st.isFile()) {
    const handle = await open(target, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

/**
 * BK-1: versioni precedenti dei file, in /data/backups (D3).
 * Ogni percorso ha una cartella con nome = hash del percorso, così percorsi
 * profondi o file e cartelle con lo stesso nome non si sovrappongono.
 */
export class BackupStore {
  private readonly lock = new KeyedLock();

  constructor(
    readonly dir: string,
    private readonly keep: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private keyDir(rel: string): string {
    return path.join(this.dir, createHash('sha256').update(rel).digest('hex'));
  }

  private async prepare(rel: string): Promise<string> {
    const dir = this.keyDir(rel);
    await mkdir(dir, { recursive: true });
    for (const name of await readdir(dir)) {
      // Resti di una scrittura interrotta (riavvio a metà): chiamato sotto il lock della chiave.
      if (TEMP_RE.test(name)) await rm(path.join(dir, name), { recursive: true, force: true });
    }
    const index = path.join(dir, INDEX_FILE);
    try {
      if ((JSON.parse(await readFile(index, 'utf8')) as { path?: unknown }).path === rel) return dir;
    } catch {
      // indice mancante o rovinato: si riscrive
    }
    await writeFileAtomic(index, Buffer.from(JSON.stringify({ path: rel }) + '\n'));
    return dir;
  }

  /** Id delle versioni di una cartella, dalla più vecchia. */
  private async ids(dir: string): Promise<string[]> {
    return (await readdir(dir)).filter((n) => VERSION_RE.test(n)).sort(compareIds);
  }

  /**
   * Scrive una versione: prima con un nome temporaneo (sincronizzato su disco), poi la
   * rinomina. Un errore a metà (disco pieno) non lascia versioni mozzate nell'elenco.
   * L'id è sempre successivo all'ultima versione, anche se l'orologio torna indietro.
   * Se il contenuto è uguale all'ultima versione non se ne crea un'altra: tentativi
   * ripetuti o ripristini annullati non cancellano la cronologia vera.
   */
  private store(
    rel: string,
    reason: BackupReason,
    write: (target: string) => Promise<void>,
    same?: (newest: string) => Promise<boolean>,
  ): Promise<string> {
    const dir = this.keyDir(rel);
    return this.lock.run(dir, async () => {
      await this.prepare(rel);
      const ids = await this.ids(dir);
      const newest = ids[ids.length - 1];
      if (newest && same) {
        try {
          if (await same(path.join(dir, newest))) return newest;
        } catch {
          // versione illeggibile: se ne crea una nuova
        }
      }
      let ms = this.now().getTime();
      if (newest) ms = Math.max(ms, Date.parse(parseTimestamp(VERSION_RE.exec(newest)![1]!)) + 1);
      const tmp = path.join(dir, `.tmp-${randomBytes(6).toString('hex')}`);
      let id: string;
      try {
        await write(tmp);
        await syncTree(tmp);
        // Un'altra istanza potrebbe aver usato lo stesso millisecondo: si va avanti.
        for (;;) {
          id = `${compactTimestamp(new Date(ms))}-${reason}`;
          try {
            await stat(path.join(dir, id));
            ms++;
          } catch {
            break;
          }
        }
        await rename(tmp, path.join(dir, id));
      } catch (err) {
        await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
        throw err;
      }
      await syncDir(dir);
      await this.prune(dir, id);
      return id;
    });
  }

  async saveFile(rel: string, data: Buffer, reason: BackupReason): Promise<string> {
    return this.store(
      rel,
      reason,
      async (target) => {
        const handle = await open(target, 'wx');
        try {
          await handle.writeFile(data);
        } finally {
          await handle.close();
        }
      },
      async (newest) => {
        const st = await stat(newest);
        return st.isFile() && st.size === data.length && (await readFile(newest)).equals(data);
      },
    );
  }

  /** Come saveFile, ma copia direttamente dal disco: niente file interi in memoria. */
  async saveFileFrom(rel: string, source: string, reason: BackupReason): Promise<string> {
    return this.store(
      rel,
      reason,
      (target) => copyFile(source, target, constants.COPYFILE_EXCL),
      async (newest) => (await stat(newest)).isFile() && (await sameFileContent(source, newest)),
    );
  }

  async saveTree(rel: string, source: string, reason: BackupReason): Promise<string> {
    return this.store(rel, reason, (target) =>
      cp(source, target, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false }),
    );
  }

  /** Versioni dalla più recente. */
  async list(rel: string): Promise<Version[]> {
    const dir = this.keyDir(rel);
    let ids: string[];
    try {
      ids = await this.ids(dir);
    } catch {
      return [];
    }
    const versions: Version[] = [];
    for (const id of ids.reverse()) {
      const m = VERSION_RE.exec(id)!;
      let st: Stats;
      try {
        st = await stat(path.join(dir, id));
      } catch {
        continue;
      }
      versions.push({
        id,
        reason: m[3] as BackupReason,
        createdAt: parseTimestamp(m[1]!),
        kind: st.isDirectory() ? 'directory' : 'file',
        size: st.isDirectory() ? 0 : st.size,
      });
    }
    return versions;
  }

  async statVersion(rel: string, id: string): Promise<Stats> {
    if (!VERSION_RE.test(id)) throw Object.assign(new Error('versione non valida'), { code: 'ENOENT' });
    return stat(path.join(this.keyDir(rel), id));
  }

  async read(rel: string, id: string): Promise<Buffer> {
    if (!VERSION_RE.test(id)) throw Object.assign(new Error('versione non valida'), { code: 'ENOENT' });
    return readFile(path.join(this.keyDir(rel), id));
  }

  /** Dopo lo spostamento di una cartella la cronologia dei file al suo interno la segue. */
  async moveTree(fromRel: string, toRel: string): Promise<void> {
    let dirs: string[];
    try {
      dirs = await readdir(this.dir);
    } catch {
      return;
    }
    for (const name of dirs) {
      let rel: string;
      try {
        rel = (JSON.parse(await readFile(path.join(this.dir, name, INDEX_FILE), 'utf8')) as { path: string }).path;
      } catch {
        continue;
      }
      if (typeof rel === 'string' && rel.startsWith(fromRel + '/')) await this.move(rel, toRel + rel.slice(fromRel.length));
    }
  }

  /** Dopo una rinomina la cronologia segue il file, se la destinazione non ne ha già una. */
  async move(fromRel: string, toRel: string): Promise<void> {
    const from = this.keyDir(fromRel);
    const to = this.keyDir(toRel);
    await this.lock.runAll([from, to], async () => {
      try {
        await stat(to);
        return;
      } catch {
        // nessuna cronologia per la destinazione: si può spostare
      }
      try {
        await rename(from, to);
      } catch {
        return;
      }
      await writeFileAtomic(path.join(to, INDEX_FILE), Buffer.from(JSON.stringify({ path: toRel }) + '\n'));
    });
  }

  /** Tiene le ultime N versioni; quella appena creata non si tocca mai. */
  private async prune(dir: string, created: string): Promise<void> {
    const ids = (await this.ids(dir)).reverse().filter((id) => id !== created);
    for (const id of ids.slice(Math.max(0, this.keep - 1))) {
      await rm(path.join(dir, id), { recursive: true, force: true });
    }
  }
}
