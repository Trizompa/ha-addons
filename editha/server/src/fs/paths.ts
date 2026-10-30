import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { EdithaError, fromFsError } from '../errors.js';

/** Cartelle di primo livello in sola lettura (SEC-8, D9). */
export const READ_ONLY_DIRS: readonly string[] = ['.storage', '.cloud', 'deps', 'tts', '.git'];
/** Cartelle saltate a qualunque profondità da ricerche e filtri (copie di .storage, repository). */
export const NESTED_SKIP_DIRS: readonly string[] = ['.storage', '.cloud', '.git'];

export interface ResolvedPath {
  /** Percorso relativo alla radice, normalizzato ('' = radice). */
  rel: string;
  /** Percorso assoluto sul disco. */
  abs: string;
}

/**
 * Unico punto in cui un percorso ricevuto dal client diventa un percorso sul disco (SEC-2).
 * I percorsi del client sono relativi alla radice, in formato POSIX.
 */
export class PathGuard {
  private constructor(readonly root: string) {}

  static async create(root: string): Promise<PathGuard> {
    return new PathGuard(await realpath(root));
  }

  /** Controllo lessicale: niente byte nulli, percorsi assoluti o uscite con "..". */
  normalize(input: string): string {
    if (typeof input !== 'string' || input.includes('\0')) {
      throw new EdithaError('invalid_request', 'Percorso non valido');
    }
    if (path.posix.isAbsolute(input)) {
      throw new EdithaError('forbidden_path', 'Sono ammessi solo percorsi relativi a /config');
    }
    const norm = path.posix.normalize(input === '' ? '.' : input).replace(/\/+$/, '');
    if (norm === '..' || norm.startsWith('../')) {
      throw new EdithaError('forbidden_path', 'Il percorso esce da /config');
    }
    return norm === '.' || norm === '' ? '' : norm;
  }

  isInside(abs: string): boolean {
    return abs === this.root || abs.startsWith(this.root + path.sep);
  }

  /** Percorso relativo alla radice di un percorso assoluto già verificato. */
  relativeOf(abs: string): string {
    return path.relative(this.root, abs).split(path.sep).join('/');
  }

  /**
   * Voce esistente, seguendo i link simbolici: la destinazione reale deve stare
   * dentro la radice. Usato per leggere e salvare.
   */
  async resolveExisting(input: string): Promise<ResolvedPath> {
    const rel = this.normalize(input);
    let real: string;
    try {
      real = await realpath(path.join(this.root, rel));
    } catch (err) {
      throw fromFsError(err, rel);
    }
    if (!this.isInside(real)) {
      throw new EdithaError('forbidden_path', 'Il percorso punta fuori da /config', { path: rel });
    }
    return { rel, abs: real };
  }

  /**
   * La voce in sé, senza seguire un eventuale link finale: la cartella che la contiene
   * deve stare dentro la radice. Usato per creare, rinominare ed eliminare.
   */
  async resolveEntry(input: string): Promise<ResolvedPath> {
    const rel = this.normalize(input);
    if (rel === '') return { rel, abs: this.root };
    const lexical = path.join(this.root, rel);
    let parent: string;
    try {
      parent = await realpath(path.dirname(lexical));
    } catch (err) {
      throw fromFsError(err, path.posix.dirname(rel));
    }
    if (!this.isInside(parent)) {
      throw new EdithaError('forbidden_path', 'Il percorso punta fuori da /config', { path: rel });
    }
    return { rel, abs: path.join(parent, path.basename(lexical)) };
  }

  /** Va valutato sul percorso reale, così un link verso .storage non aggira il blocco. */
  isReadOnly(abs: string): boolean {
    const top = this.relativeOf(abs).split('/')[0] ?? '';
    return READ_ONLY_DIRS.includes(top);
  }

  assertWritable(resolved: ResolvedPath): void {
    if (resolved.abs === this.root) {
      throw new EdithaError('forbidden_path', 'Operazione non consentita sulla radice di /config');
    }
    if (this.isReadOnly(resolved.abs)) {
      throw new EdithaError('read_only', `Percorso in sola lettura: ${resolved.rel}`, { path: resolved.rel });
    }
  }
}
