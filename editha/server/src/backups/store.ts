import path from 'node:path';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import type { Stats } from 'node:fs';
import { copyFile, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';

export type BackupReason = 'save' | 'delete' | 'restore';

export interface Version {
  /** Identificativo ordinabile, es. "20261015T064156123Z-save". */
  id: string;
  reason: BackupReason;
  createdAt: string;
  kind: 'file' | 'directory';
  size: number;
}

const VERSION_RE = /^(\d{8}T\d{9}Z)(?:\.(\d+))?-(save|delete|restore)$/;
const INDEX_FILE = 'index.json';

function compactTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:.]/g, '');
}

function parseTimestamp(ts: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/.exec(ts);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7]}Z` : ts;
}

/**
 * BK-1: versioni precedenti dei file, in /data/backups (D3).
 * Ogni percorso ha una cartella con nome = hash del percorso, così percorsi
 * profondi o file e cartelle con lo stesso nome non si sovrappongono.
 */
export class BackupStore {
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
    await writeFile(path.join(dir, INDEX_FILE), JSON.stringify({ path: rel }) + '\n');
    return dir;
  }

  /** Riserva un nome di versione libero (due versioni nello stesso millisecondo restano distinte). */
  private async allocate(dir: string, reason: BackupReason, write: (target: string) => Promise<void>): Promise<string> {
    const ts = compactTimestamp(this.now());
    for (let i = 0; ; i++) {
      const id = i === 0 ? `${ts}-${reason}` : `${ts}.${i}-${reason}`;
      const target = path.join(dir, id);
      try {
        await stat(target);
        continue;
      } catch {
        await write(target);
        return id;
      }
    }
  }

  async saveFile(rel: string, data: Buffer, reason: BackupReason): Promise<string> {
    const dir = await this.prepare(rel);
    const id = await this.allocate(dir, reason, (target) => writeFile(target, data, { flag: 'wx' }));
    await this.prune(dir);
    return id;
  }

  /** Come saveFile, ma copia direttamente dal disco: niente file interi in memoria. */
  async saveFileFrom(rel: string, source: string, reason: BackupReason): Promise<string> {
    const dir = await this.prepare(rel);
    const id = await this.allocate(dir, reason, (target) => copyFile(source, target, constants.COPYFILE_EXCL));
    await this.prune(dir);
    return id;
  }

  async saveTree(rel: string, source: string, reason: BackupReason): Promise<string> {
    const dir = await this.prepare(rel);
    const id = await this.allocate(dir, reason, (target) =>
      cp(source, target, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false }),
    );
    await this.prune(dir);
    return id;
  }

  /** Versioni dalla più recente. */
  async list(rel: string): Promise<Version[]> {
    const dir = this.keyDir(rel);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    const versions: Version[] = [];
    for (const id of names) {
      const m = VERSION_RE.exec(id);
      if (!m) continue;
      const st = await stat(path.join(dir, id));
      versions.push({
        id,
        reason: m[3] as BackupReason,
        createdAt: parseTimestamp(m[1]!),
        kind: st.isDirectory() ? 'directory' : 'file',
        size: st.isDirectory() ? 0 : st.size,
      });
    }
    return versions.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
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
    await writeFile(path.join(to, INDEX_FILE), JSON.stringify({ path: toRel }) + '\n');
  }

  private async prune(dir: string): Promise<void> {
    const ids = (await readdir(dir)).filter((n) => VERSION_RE.test(n)).sort().reverse();
    for (const id of ids.slice(this.keep)) {
      await rm(path.join(dir, id), { recursive: true, force: true });
    }
  }
}
