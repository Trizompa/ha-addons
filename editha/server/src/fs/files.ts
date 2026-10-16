import path from 'node:path';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { copyFile, cp, lstat, mkdir, open, opendir, readdir, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { isMap, isScalar, LineCounter, parseDocument } from 'yaml';
import { EdithaError, fromFsError } from '../errors.js';
import type { BackupStore, Version } from '../backups/store.js';
import { isTempName, writeFileAtomic } from './atomic.js';
import { KeyedLock } from './lock.js';
import { createZip, type ZipEntry } from './zip.js';
import {
  SEARCH_BUDGET_MS,
  searchPattern,
  type ReplaceMessage,
  type SearchMessage,
  type SearchOptions,
  type SearchResult,
} from './search.js';
import { Worker } from 'node:worker_threads';
import type { PathGuard, ResolvedPath } from './paths.js';

export type EntryType = 'file' | 'directory' | 'other';

export interface Entry {
  name: string;
  path: string;
  type: EntryType;
  symlink: boolean;
  size: number;
  mtime: string;
  readOnly: boolean;
  /** Solo per le cartelle: true se non contiene nulla (l'albero non mostra la freccia). */
  empty?: boolean;
}

export interface FileContent {
  path: string;
  content: string;
  etag: string;
  size: number;
  mtime: string;
  readOnly: boolean;
}

export type { SearchMatch, SearchOptions, SearchResult } from './search.js';
export { searchPattern } from './search.js';

/** HA-4: una chiave di secrets.yaml, senza il valore (SEC-7). */
export interface SecretKey {
  key: string;
  /** File secrets.yaml che la definisce. */
  path: string;
  /** Riga (da 1) della chiave. */
  line: number;
}

/**
 * Chiavi al primo livello di un secrets.yaml, lette con un vero parser YAML: un valore su
 * più righe non può mai diventare una "chiave" e finire nel browser (SEC-7).
 */
export function secretKeysOf(text: string): { key: string; line: number }[] {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text.replace(/^\uFEFF/, ''), { lineCounter, strict: false, prettyErrors: false });
  if (!isMap(doc.contents)) return [];
  // Dopo un errore di sintassi il parser può scambiare il resto di un valore per una chiave:
  // si tengono solo le chiavi prima del primo errore.
  const limit = Math.min(Infinity, ...doc.errors.map((e) => e.pos[0]));
  const keys: { key: string; line: number }[] = [];
  for (const pair of doc.contents.items) {
    if (!isScalar(pair.key) || pair.key.value === null || pair.key.value === undefined) continue;
    const start = pair.key.range?.[0] ?? 0;
    if (start >= limit) break;
    keys.push({ key: String(pair.key.value), line: lineCounter.linePos(start).line });
  }
  return keys;
}

export interface SaveResult {
  path: string;
  etag: string;
  size: number;
  mtime: string;
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function etagOf(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** SEC-5: byte nulli nelle prime righe o UTF-8 non valido. */
export function decodeText(data: Buffer): string | null {
  if (data.subarray(0, 8000).includes(0)) return null;
  try {
    return utf8.decode(data);
  } catch {
    return null;
  }
}

function typeOf(st: Stats): EntryType {
  if (st.isFile()) return 'file';
  if (st.isDirectory()) return 'directory';
  return 'other';
}

function joinRel(dir: string, name: string): string {
  return dir === '' ? name : `${dir}/${name}`;
}

/** Dimensione totale dei file di una cartella (link esclusi); si ferma appena supera `limit`. */
async function treeSize(abs: string, limit: number): Promise<number> {
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const d of await readdir(dir, { withFileTypes: true })) {
      if (total > limit) return;
      if (d.isSymbolicLink()) continue;
      const child = path.join(dir, d.name);
      if (d.isDirectory()) await walk(child);
      else if (d.isFile()) total += (await stat(child)).size;
    }
  };
  await walk(abs);
  return total;
}

class TransferTooLarge extends EdithaError {
  constructor(size: number, limit: number) {
    super('too_large', `Troppo grande (${size} byte, limite ${limit})`, { size, limit });
  }
}

/** Operazioni sui file di /config. Ogni percorso passa da PathGuard. */
export class FileService {
  private readonly lock = new KeyedLock();

  constructor(
    private readonly guard: PathGuard,
    private readonly backups: BackupStore,
    private readonly maxFileSize: number,
    /** Limite per download e upload (file binari e archivi ZIP). */
    private readonly maxDownload = 50 * 1024 * 1024,
  ) {}

  /** FS-1: contenuto di una cartella, cartelle prima e poi file. */
  async list(input: string): Promise<Entry[]> {
    const dir = await this.guard.resolveExisting(input);
    const dirStat = await stat(dir.abs);
    if (!dirStat.isDirectory()) throw new EdithaError('not_a_directory', `Non è una cartella: ${dir.rel}`);

    const dirents = await readdir(dir.abs, { withFileTypes: true });
    const entries: Entry[] = [];
    for (const d of dirents) {
      if (isTempName(d.name)) continue;
      const abs = path.join(dir.abs, d.name);
      const entry = await this.describe(abs, joinRel(dir.rel, d.name), d.name, d.isSymbolicLink());
      if (entry) entries.push(entry);
    }
    return entries.sort((a, b) => {
      if ((a.type === 'directory') !== (b.type === 'directory')) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
    });
  }

  private async describe(abs: string, rel: string, name: string, symlink: boolean): Promise<Entry | null> {
    try {
      let target = abs;
      let st: Stats;
      if (symlink) {
        target = await realpath(abs);
        st = this.guard.isInside(target) ? await stat(target) : await lstat(abs);
      } else {
        st = await lstat(abs);
      }
      const outside = symlink && !this.guard.isInside(target);
      const type = outside ? 'other' : typeOf(st);
      const entry: Entry = {
        name,
        path: rel,
        type,
        symlink,
        size: st.isFile() ? st.size : 0,
        mtime: st.mtime.toISOString(),
        readOnly: outside || this.guard.isReadOnly(target),
      };
      if (type === 'directory') entry.empty = await isEmptyDir(target);
      return entry;
    } catch {
      // Link interrotto o voce sparita durante la lettura.
      return symlink ? { name, path: rel, type: 'other', symlink, size: 0, mtime: '', readOnly: true } : null;
    }
  }

  async read(input: string): Promise<FileContent> {
    const file = await this.guard.resolveExisting(input);
    const st = await this.statFile(file);
    if (st.size > this.maxFileSize) {
      throw new EdithaError('too_large', `File troppo grande (${st.size} byte)`, {
        size: st.size,
        limit: this.maxFileSize,
      });
    }
    const data = await readFile(file.abs);
    const content = decodeText(data);
    if (content === null) throw new EdithaError('binary', `Il file non è testo: ${file.rel}`);
    return {
      path: file.rel,
      content,
      etag: etagOf(data),
      size: data.length,
      mtime: st.mtime.toISOString(),
      readOnly: this.guard.isReadOnly(file.abs),
    };
  }

  /**
   * Salva solo se il file su disco è ancora quello letto dal client (SEC-4),
   * conserva la versione precedente (BK-1) e scrive in modo atomico (SEC-3).
   */
  async write(input: string, content: string, etag: string): Promise<SaveResult> {
    const file = await this.guard.resolveExisting(input);
    this.guard.assertWritable(file);
    const data = Buffer.from(content, 'utf8');
    if (data.length > this.maxFileSize) {
      throw new EdithaError('too_large', `Contenuto troppo grande (${data.length} byte)`, {
        size: data.length,
        limit: this.maxFileSize,
      });
    }
    return this.lock.run(file.abs, async () => {
      const st = await this.statFile(file);
      const current = await readFile(file.abs);
      const currentEtag = etagOf(current);
      if (currentEtag !== etag) {
        throw new EdithaError('conflict', 'Il file è stato modificato da un altro programma', {
          path: file.rel,
          etag: currentEtag,
        });
      }
      if (!current.equals(data)) {
        await this.backups.saveFile(this.guard.relativeOf(file.abs), current, 'save');
        await writeFileAtomic(file.abs, data, st);
      }
      const after = await stat(file.abs);
      return { path: file.rel, etag: etagOf(data), size: data.length, mtime: after.mtime.toISOString() };
    });
  }

  /** FS-2: crea un file (con contenuto iniziale opzionale) o una cartella; non sovrascrive mai. */
  async create(input: string, type: 'file' | 'directory', content = ''): Promise<Entry> {
    const target = await this.guard.resolveEntry(input);
    this.guard.assertWritable(target);
    try {
      if (type === 'directory') {
        await mkdir(target.abs);
      } else {
        const handle = await open(target.abs, 'wx', 0o644);
        try {
          await handle.writeFile(content, 'utf8');
        } finally {
          await handle.close();
        }
      }
    } catch (err) {
      throw fromFsError(err, target.rel);
    }
    return (await this.describe(target.abs, target.rel, path.posix.basename(target.rel), false))!;
  }

  /** FS-3: rinomina o sposta; la destinazione non deve esistere. */
  async rename(fromInput: string, toInput: string): Promise<Entry> {
    const from = await this.guard.resolveEntry(fromInput);
    const to = await this.guard.resolveEntry(toInput);
    this.guard.assertWritable(from);
    this.guard.assertWritable(to);
    if (to.abs === from.abs) return this.entryOf(to);
    if (to.abs.startsWith(from.abs + path.sep)) {
      throw new EdithaError('invalid_request', 'Una cartella non può essere spostata dentro sé stessa');
    }
    // Origine e destinazione insieme: due spostamenti verso lo stesso nome non si sovrascrivono.
    return this.lock.runAll([from.abs, to.abs], async () => {
      const st = await this.lstatEntry(from);
      if (await this.exists(to.abs)) throw new EdithaError('already_exists', `Esiste già: ${to.rel}`, { path: to.rel });
      try {
        await rename(from.abs, to.abs);
      } catch (err) {
        throw fromFsError(err, to.rel);
      }
      const fromKey = this.guard.relativeOf(from.abs);
      const toKey = this.guard.relativeOf(to.abs);
      if (st.isFile()) await this.backups.move(fromKey, toKey);
      else if (st.isDirectory()) await this.backups.moveTree(fromKey, toKey);
      return this.entryOf(to);
    });
  }

  /** FS-4: elimina dopo averne conservato una copia (BK-1). */
  async remove(input: string): Promise<{ path: string; backup: string | null }> {
    const target = await this.guard.resolveEntry(input);
    this.guard.assertWritable(target);
    return this.lock.run(target.abs, async () => {
      const st = await this.lstatEntry(target);
      const key = this.guard.relativeOf(target.abs);
      let backup: string | null = null;
      // Copie di sicurezza solo entro un limite: un database o una cartella di video
      // non devono riempire /data. Oltre il limite si elimina senza copia (backup: null).
      if (st.isFile()) {
        if (st.size <= this.maxDownload) backup = await this.backups.saveFileFrom(key, target.abs, 'delete');
      } else if (st.isDirectory()) {
        if ((await treeSize(target.abs, this.maxDownload)) <= this.maxDownload) {
          backup = await this.backups.saveTree(key, target.abs, 'delete');
        }
      }
      await rm(target.abs, { recursive: st.isDirectory(), force: false });
      return { path: target.rel, backup };
    });
  }

  /** FS-6: contenuto di un file per il download (anche binario). */
  async download(input: string): Promise<{ name: string; data: Buffer }> {
    const file = await this.guard.resolveExisting(input);
    const st = await this.statFile(file);
    if (st.size > this.maxDownload) {
      throw new TransferTooLarge(st.size, this.maxDownload);
    }
    return { name: path.posix.basename(file.rel) || 'config', data: await readFile(file.abs) };
  }

  /** FS-6: file così com'è, cartella come ZIP. */
  async downloadAny(input: string): Promise<{ name: string; data: Buffer; zip: boolean }> {
    const target = await this.guard.resolveExisting(input);
    if ((await stat(target.abs)).isDirectory()) return { ...(await this.downloadFolder(input)), zip: true };
    return { ...(await this.download(input)), zip: false };
  }

  /** FS-6: una cartella come archivio ZIP (link simbolici esclusi, dimensione limitata). */
  async downloadFolder(input: string): Promise<{ name: string; data: Buffer }> {
    const dir = await this.guard.resolveExisting(input);
    if (!(await stat(dir.abs)).isDirectory()) {
      throw new EdithaError('not_a_directory', `Non è una cartella: ${dir.rel}`);
    }
    const entries: ZipEntry[] = [];
    let total = 0;
    const walk = async (abs: string, prefix: string): Promise<void> => {
      for (const d of await readdir(abs, { withFileTypes: true })) {
        if (d.isSymbolicLink() || isTempName(d.name)) continue;
        const childAbs = path.join(abs, d.name);
        const name = prefix ? `${prefix}/${d.name}` : d.name;
        if (d.isDirectory()) {
          await walk(childAbs, name);
        } else if (d.isFile()) {
          const st = await stat(childAbs);
          total += st.size;
          if (total > this.maxDownload) throw new TransferTooLarge(total, this.maxDownload);
          entries.push({ name, data: await readFile(childAbs), mtime: st.mtime });
        }
      }
    };
    await walk(dir.abs, '');
    const base = path.posix.basename(dir.rel) || 'config';
    return { name: `${base}.zip`, data: createZip(entries) };
  }

  /**
   * FS-6: carica un file dal PC. Senza `overwrite` non sostituisce mai un file esistente;
   * con `overwrite` la versione precedente finisce nei backup (BK-1).
   */
  async upload(dirInput: string, name: string, data: Buffer, overwrite: boolean): Promise<Entry> {
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\0')) {
      throw new EdithaError('invalid_request', 'Nome di file non valido');
    }
    const dir = await this.guard.resolveExisting(dirInput);
    if (!(await stat(dir.abs)).isDirectory()) {
      throw new EdithaError('not_a_directory', `Non è una cartella: ${dir.rel}`);
    }
    const target = await this.guard.resolveEntry(dir.rel ? `${dir.rel}/${name}` : name);
    this.guard.assertWritable(target);
    return this.lock.run(target.abs, async () => {
      let existing: Stats | null = null;
      try {
        existing = await lstat(target.abs);
      } catch {
        existing = null;
      }
      if (existing) {
        if (!existing.isFile()) throw new EdithaError('not_a_file', `Non è un file: ${target.rel}`);
        if (!overwrite) throw new EdithaError('already_exists', `Esiste già: ${target.rel}`, { path: target.rel });
        await this.backups.saveFile(this.guard.relativeOf(target.abs), await readFile(target.abs), 'save');
      }
      await writeFileAtomic(target.abs, data, existing ?? undefined);
      return (await this.describe(target.abs, target.rel, name, false))!;
    });
  }

  /**
   * SR-1/SR-2/SR-4: cerca un testo (o un'espressione regolare) in tutti i file di testo di
   * /config. Gira in un worker con un tempo massimo: un'espressione regolare lentissima
   * (es. "(a+)+$") non può bloccare il server, il worker viene fermato e i risultati
   * trovati fino a quel momento restano validi (troncati).
   */
  async search(opts: SearchOptions): Promise<SearchResult> {
    searchPattern(opts);
    return new Promise((resolve) => {
      const out: SearchResult = { results: [], files: 0, matches: 0, truncated: false };
      const worker = new Worker(new URL('./search-worker.js', import.meta.url), {
        workerData: { mode: 'search', root: this.guard.root, opts, maxFileSize: this.maxFileSize },
      });
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        void worker.terminate();
        resolve(out);
      };
      const timer = setTimeout(() => {
        out.truncated = true;
        finish();
      }, SEARCH_BUDGET_MS);
      worker.on('message', (msg: SearchMessage) => {
        if (msg.type === 'file') {
          out.results.push({ path: msg.path, matches: msg.matches });
          out.matches += msg.matches.length;
        } else {
          out.files = msg.files;
          out.truncated ||= msg.truncated;
          finish();
        }
      });
      worker.on('error', () => {
        out.truncated = true;
        finish();
      });
      worker.on('exit', finish);
    });
  }

  /**
   * SR-3: sostituisce in più file. Le nuove versioni si calcolano nel worker (un'espressione
   * regolare lenta non blocca il server e, se va oltre il tempo massimo, non si tocca nessun
   * file); poi ogni file si scrive con il suo lock, conservando la versione precedente (BK-1).
   * Un file cambiato nel frattempo, in sola lettura o non di testo viene saltato.
   */
  async replace(
    paths: string[],
    opts: SearchOptions,
    replacement: string,
  ): Promise<{ files: { path: string; count: number; etag: string }[]; skipped: { path: string; reason: string }[] }> {
    searchPattern(opts);
    const skipped: { path: string; reason: string }[] = [];
    const targets: { rel: string; abs: string }[] = [];
    for (const input of [...new Set(paths)]) {
      try {
        const file = await this.guard.resolveExisting(input);
        this.guard.assertWritable(file);
        // secrets.yaml non si tocca mai da una sostituzione di massa (come per la ricerca).
        if (path.posix.basename(file.rel) === 'secrets.yaml') throw new EdithaError('read_only', 'secrets.yaml');
        const st = await this.statFile(file);
        if (st.size > this.maxFileSize) throw new EdithaError('too_large', file.rel);
        targets.push({ rel: file.rel, abs: file.abs });
      } catch (err) {
        skipped.push({ path: input, reason: err instanceof EdithaError ? err.code : 'error' });
      }
    }
    const computed = await new Promise<Extract<ReplaceMessage, { type: 'file' }>[]>((resolve, reject) => {
      const out: Extract<ReplaceMessage, { type: 'file' }>[] = [];
      const worker = new Worker(new URL('./search-worker.js', import.meta.url), {
        workerData: { mode: 'replace', files: targets, opts, replacement },
      });
      let finished = false;
      const end = (err?: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        void worker.terminate();
        if (err) reject(err);
        else resolve(out);
      };
      const timer = setTimeout(
        () => end(new EdithaError('invalid_request', 'Sostituzione troppo lenta: semplifica l\'espressione regolare')),
        SEARCH_BUDGET_MS,
      );
      worker.on('message', (msg: ReplaceMessage) => {
        if (msg.type === 'file') out.push(msg);
        else end();
      });
      worker.on('error', (err) => end(err));
      worker.on('exit', () => end(new Error('worker terminato')));
    });
    const files: { path: string; count: number; etag: string }[] = [];
    for (const change of computed) {
      const abs = targets.find((t) => t.rel === change.rel)!.abs;
      await this.lock.run(abs, async () => {
        const st = await stat(abs);
        const current = await readFile(abs);
        if (etagOf(current) !== change.etag) {
          skipped.push({ path: change.rel, reason: 'conflict' });
          return;
        }
        const data = Buffer.from(change.content, 'utf8');
        await this.backups.saveFile(this.guard.relativeOf(abs), current, 'save');
        await writeFileAtomic(abs, data, st);
        files.push({ path: change.rel, count: change.count, etag: etagOf(data) });
      });
    }
    return { files, skipped };
  }

  /**
   * FS-5: tutte le cartelle scrivibili, come destinazioni di "Sposta in…".
   * Esclude le cartelle di sistema (SEC-8) e i link; limitato per non bloccarsi su /config enormi.
   */
  async folders(limit = 5000): Promise<string[]> {
    const result: string[] = [];
    const walk = async (abs: string, rel: string): Promise<void> => {
      let dirents;
      try {
        dirents = await readdir(abs, { withFileTypes: true });
      } catch {
        return;
      }
      const dirs = dirents
        .filter((d) => d.isDirectory() && !d.isSymbolicLink() && !isTempName(d.name))
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
      for (const name of dirs) {
        if (result.length >= limit) return;
        const childAbs = path.join(abs, name);
        if (this.guard.isReadOnly(childAbs)) continue;
        const childRel = joinRel(rel, name);
        result.push(childRel);
        await walk(childAbs, childRel);
      }
    };
    await walk(this.guard.root, '');
    return result;
  }

  /**
   * HA-4: chiavi disponibili per `!secret` in un file. Come HA, si cerca secrets.yaml nella
   * cartella del file e poi in quelle sopra fino a /config; vince la definizione più vicina.
   * Solo le chiavi: i valori non lasciano mai il server (SEC-7).
   */
  async secrets(input: string): Promise<SecretKey[]> {
    const target = await this.guard.resolveEntry(input);
    const found = new Map<string, SecretKey>();
    let dir = path.posix.dirname(target.rel);
    if (dir === '.') dir = '';
    for (;;) {
      const rel = dir ? `${dir}/secrets.yaml` : 'secrets.yaml';
      try {
        const file = await this.guard.resolveExisting(rel);
        const st = await stat(file.abs);
        if (st.isFile() && st.size <= this.maxFileSize) {
          for (const { key, line } of secretKeysOf(await readFile(file.abs, 'utf8'))) {
            if (!found.has(key)) found.set(key, { key, path: file.rel, line });
          }
        }
      } catch {
        // nessun secrets.yaml a questo livello
      }
      if (dir === '') break;
      const up = path.posix.dirname(dir);
      dir = up === '.' ? '' : up;
    }
    return [...found.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  /** BK-2: versioni conservate di un file. */
  async versions(input: string): Promise<Version[]> {
    const target = await this.historyTarget(input);
    return this.backups.list(this.guard.relativeOf(target.abs));
  }

  /** BK-3: testo di una versione conservata, per il confronto con il file attuale. */
  async versionContent(input: string, id: string): Promise<{ path: string; id: string; content: string }> {
    const target = await this.historyTarget(input);
    const data = await this.readVersion(target, id);
    const content = decodeText(data);
    if (content === null) throw new EdithaError('binary', `La versione non è testo: ${target.rel}`);
    return { path: target.rel, id, content };
  }

  /**
   * BK-4: rimette una versione al posto del file (o lo ricrea se è stato eliminato).
   * Il contenuto sostituito diventa a sua volta una versione, quindi il ripristino si annulla.
   */
  async restore(input: string, id: string): Promise<SaveResult> {
    const target = await this.historyTarget(input);
    this.guard.assertWritable(target);
    const data = await this.readVersion(target, id);
    if (data.length > this.maxFileSize) {
      throw new EdithaError('too_large', `Versione troppo grande (${data.length} byte)`, {
        size: data.length,
        limit: this.maxFileSize,
      });
    }
    return this.lock.run(target.abs, async () => {
      let existing: Stats | null = null;
      try {
        existing = await lstat(target.abs);
      } catch {
        existing = null;
      }
      if (existing) {
        if (!existing.isFile()) throw new EdithaError('not_a_file', `Non è un file: ${target.rel}`);
        const current = await readFile(target.abs);
        if (!current.equals(data)) {
          await this.backups.saveFile(this.guard.relativeOf(target.abs), current, 'restore');
          await writeFileAtomic(target.abs, data, existing);
        }
      } else {
        await writeFileAtomic(target.abs, data);
      }
      const after = await stat(target.abs);
      return { path: target.rel, etag: etagOf(data), size: data.length, mtime: after.mtime.toISOString() };
    });
  }

  /**
   * I salvataggi conservano le versioni sotto il percorso reale del file: per un file aperto
   * attraverso un collegamento la cronologia va cercata lì. Un file eliminato non esiste più,
   * quindi si usa il percorso così com'è.
   */
  private async historyTarget(input: string): Promise<ResolvedPath> {
    try {
      const real = await this.guard.resolveExisting(input);
      return { rel: this.guard.relativeOf(real.abs), abs: real.abs };
    } catch {
      return this.guard.resolveEntry(input);
    }
  }

  private async readVersion(target: ResolvedPath, id: string): Promise<Buffer> {
    try {
      const st = await this.backups.statVersion(this.guard.relativeOf(target.abs), id);
      if (!st.isFile()) throw new EdithaError('not_a_file', 'La versione è una cartella');
      return await this.backups.read(this.guard.relativeOf(target.abs), id);
    } catch (err) {
      if (err instanceof EdithaError) throw err;
      throw new EdithaError('not_found', `Versione non trovata: ${id}`);
    }
  }

  /** FS-8: duplica un file o una cartella; la destinazione non deve esistere. */
  async copy(fromInput: string, toInput: string): Promise<Entry> {
    const from = await this.guard.resolveExisting(fromInput);
    const to = await this.guard.resolveEntry(toInput);
    this.guard.assertWritable(to);
    if (to.abs === from.abs || to.abs.startsWith(from.abs + path.sep)) {
      throw new EdithaError('invalid_request', 'Una cartella non può essere copiata dentro sé stessa');
    }
    const st = await stat(from.abs);
    return this.lock.run(to.abs, async () => {
      if (await this.exists(to.abs)) throw new EdithaError('already_exists', `Esiste già: ${to.rel}`, { path: to.rel });
      try {
        if (st.isDirectory()) {
          const size = await treeSize(from.abs, this.maxDownload);
          if (size > this.maxDownload) throw new TransferTooLarge(size, this.maxDownload);
          // I link simbolici restano link: niente copie di file fuori da /config.
          await cp(from.abs, to.abs, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
        } else if (st.isFile()) {
          if (st.size > this.maxDownload) throw new TransferTooLarge(st.size, this.maxDownload);
          await copyFile(from.abs, to.abs, fsConstants.COPYFILE_EXCL);
        } else {
          throw new EdithaError('not_a_file', `Non è un file: ${from.rel}`);
        }
      } catch (err) {
        if (err instanceof EdithaError) throw err;
        throw fromFsError(err, to.rel);
      }
      return this.entryOf(to);
    });
  }

  private async statFile(file: ResolvedPath): Promise<Stats> {
    const st = await stat(file.abs);
    if (!st.isFile()) throw new EdithaError('not_a_file', `Non è un file: ${file.rel}`, { path: file.rel });
    return st;
  }

  private async lstatEntry(entry: ResolvedPath): Promise<Stats> {
    try {
      return await lstat(entry.abs);
    } catch (err) {
      throw fromFsError(err, entry.rel);
    }
  }

  private async exists(abs: string): Promise<boolean> {
    try {
      await lstat(abs);
      return true;
    } catch {
      return false;
    }
  }

  private async entryOf(target: ResolvedPath): Promise<Entry> {
    const st = await this.lstatEntry(target);
    return (await this.describe(target.abs, target.rel, path.posix.basename(target.rel), st.isSymbolicLink()))!;
  }
}

/** Cartella senza nulla dentro (i file temporanei dei salvataggi non contano); basta leggere la prima voce. */
async function isEmptyDir(abs: string): Promise<boolean> {
  try {
    const dir = await opendir(abs);
    try {
      for await (const d of dir) {
        if (!isTempName(d.name)) return false;
      }
      return true;
    } finally {
      // Uscendo dal ciclo prima della fine la cartella è già chiusa: si ignora l'errore.
      await dir.close().catch(() => {});
    }
  } catch {
    return false;
  }
}
