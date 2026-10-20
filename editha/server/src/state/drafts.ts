import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { writeFileAtomic } from '../fs/atomic.js';
import { KeyedLock } from '../fs/lock.js';

/** ED-14: modifiche non ancora salvate di un file, da recuperare alla riapertura. */
export interface Draft {
  path: string;
  content: string;
  /** Etag del file su disco quando la modifica è cominciata (SEC-4 al salvataggio). */
  etag: string;
  savedAt: string;
  /** Finestra (pagina aperta) che ha scritto la bozza; assente nelle bozze di versioni precedenti. */
  client?: string;
}

/** Bozza come la vede il client: `live` = la finestra che l'ha scritta è ancora aperta. */
export interface ListedDraft extends Draft {
  live: boolean;
  /** Da quanti ms la finestra non si fa sentire (null: sconosciuta o chiusa). */
  idleMs: number | null;
}

export const MAX_DRAFTS = 50;

/**
 * Una finestra aperta si fa sentire ogni 20 s (anche in background, dove i browser rallentano i
 * timer a uno al minuto): oltre questo silenzio la si considera chiusa.
 */
export const LIVE_MS = 90_000;

export const draftSchema = {
  type: 'object',
  required: ['path', 'content', 'etag'],
  properties: {
    path: { type: 'string', minLength: 1, maxLength: 4096 },
    content: { type: 'string' },
    etag: { type: 'string', minLength: 1, maxLength: 128 },
    client: { type: 'string', minLength: 1, maxLength: 64 },
  },
  additionalProperties: false,
} as const;

export const claimSchema = {
  type: 'object',
  required: ['path', 'client'],
  properties: {
    path: { type: 'string', minLength: 1, maxLength: 4096 },
    /** Finestra che ha scritto la bozza; assente per quelle di versioni precedenti. */
    from: { type: 'string', minLength: 1, maxLength: 64 },
    client: { type: 'string', minLength: 1, maxLength: 64 },
  },
  additionalProperties: false,
} as const;

export const aliveSchema = {
  type: 'object',
  required: ['client'],
  properties: {
    client: { type: 'string', minLength: 1, maxLength: 64 },
    closing: { type: 'boolean' },
  },
  additionalProperties: false,
} as const;

function isDraft(d: unknown): d is Draft {
  if (!d || typeof d !== 'object') return false;
  const r = d as Record<string, unknown>;
  return (
    ['path', 'content', 'etag', 'savedAt'].every((k) => typeof r[k] === 'string') &&
    (r.client === undefined || typeof r.client === 'string')
  );
}

/**
 * Una bozza per file e per finestra in /data/drafts (il nome è l'hash di percorso e finestra):
 * due finestre aperte sullo stesso file non si sovrascrivono le bozze a vicenda.
 */
export class DraftStore {
  /** Scrittura e cancellazione della stessa bozza in ordine di arrivo: una DELETE non viene superata da una PUT più lenta. */
  private readonly lock = new KeyedLock();
  /** Ultimo segnale di ogni finestra aperta (solo in memoria: dopo un riavvio si riparte da zero). */
  private readonly seen = new Map<string, number>();
  /**
   * Avvio del server: chi aveva una finestra aperta non ha ancora fatto in tempo a farsi
   * sentire, quindi per un po' una finestra sconosciuta conta come aperta.
   */
  private readonly startedAt: number;
  /** Finestre che hanno detto di chiudersi (dopo l'avvio non vanno considerate aperte). */
  private readonly closed = new Set<string>();

  constructor(
    readonly dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.startedAt = now().getTime();
  }

  private fileOf(rel: string, client?: string): string {
    // Senza finestra (bozze di versioni precedenti) il nome resta quello di prima.
    const key = client ? `${rel}\0${client}` : rel;
    return path.join(this.dir, createHash('sha256').update(key).digest('hex') + '.json');
  }

  /** La finestra è ancora aperta (`closing`: si sta chiudendo). */
  alive(client: string, closing = false): void {
    if (closing) {
      this.seen.delete(client);
      this.closed.add(client);
    } else {
      this.seen.set(client, this.now().getTime());
      this.closed.delete(client);
    }
    // Le finestre sparite da tempo non servono più; finito il periodo dopo l'avvio, nemmeno le chiuse.
    if (this.now().getTime() - this.startedAt >= LIVE_MS) this.closed.clear();
    const old = this.now().getTime() - LIVE_MS;
    for (const [c, t] of this.seen) if (t < old) this.seen.delete(c);
  }

  /** Ultimo segnale della finestra; per una sconosciuta subito dopo l'avvio, l'avvio stesso. */
  private lastSeen(client: string | undefined): number | undefined {
    if (!client) return undefined;
    const t = this.seen.get(client);
    if (t !== undefined) return t;
    return this.now().getTime() - this.startedAt < LIVE_MS && !this.closed.has(client) ? this.startedAt : undefined;
  }

  private isLive(client: string | undefined): boolean {
    const t = this.lastSeen(client);
    return t !== undefined && this.now().getTime() - t < LIVE_MS;
  }

  /** Bozze dalla più recente; quelle illeggibili vengono ignorate. */
  async list(): Promise<ListedDraft[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const drafts: Draft[] = [];
    for (const name of names.filter((n) => n.endsWith('.json'))) {
      try {
        const raw: unknown = JSON.parse(await readFile(path.join(this.dir, name), 'utf8'));
        if (isDraft(raw)) drafts.push(raw);
      } catch {
        // bozza rovinata o in scrittura: si salta
      }
    }
    return drafts
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
      .map((d) => {
        const t = this.lastSeen(d.client);
        return { ...d, live: this.isLive(d.client), idleMs: t === undefined ? null : this.now().getTime() - t };
      });
  }

  async put(rel: string, content: string, etag: string, client?: string): Promise<Draft> {
    const draft: Draft = { path: rel, content, etag, savedAt: this.now().toISOString(), ...(client ? { client } : {}) };
    const file = this.fileOf(rel, client);
    await this.lock.run(file, async () => {
      await mkdir(this.dir, { recursive: true });
      await writeFileAtomic(file, Buffer.from(JSON.stringify(draft)));
    });
    await this.prune();
    return draft;
  }

  /** Oltre MAX_DRAFTS si eliminano le bozze più vecchie (per data del file, senza leggerle). */
  private async prune(): Promise<void> {
    const names = (await readdir(this.dir)).filter((n) => n.endsWith('.json'));
    if (names.length <= MAX_DRAFTS) return;
    const dated = await Promise.all(
      names.map(async (n) => ({ n, t: await stat(path.join(this.dir, n)).then((s) => s.mtimeMs, () => 0) })),
    );
    dated.sort((a, b) => b.t - a.t);
    for (const { n } of dated.slice(MAX_DRAFTS)) await rm(path.join(this.dir, n), { force: true });
  }

  async remove(rel: string, client?: string): Promise<void> {
    const file = this.fileOf(rel, client);
    await this.lock.run(file, () => rm(file, { force: true }));
  }

  /**
   * Una finestra recupera la bozza di un'altra (`from`; assente per le bozze di versioni
   * precedenti): la bozza passa a lei e sparisce dall'originale, tutto sotto lo stesso blocco.
   * Se due finestre la chiedono insieme, solo la prima la ottiene; l'altra riceve null.
   */
  async claim(rel: string, from: string | undefined, to: string): Promise<Draft | null> {
    const source = this.fileOf(rel, from);
    const target = this.fileOf(rel, to);
    // Origine e destinazione insieme, sempre nello stesso ordine: niente stalli.
    return this.lock.runAll([source, target], async () => {
      let raw: unknown;
      try {
        raw = JSON.parse(await readFile(source, 'utf8'));
      } catch {
        return null;
      }
      if (!isDraft(raw) || raw.path !== rel) return null;
      const draft: Draft = { ...raw, client: to };
      if (source !== target) {
        await writeFileAtomic(target, Buffer.from(JSON.stringify(draft)));
        await rm(source, { force: true });
      }
      return draft;
    });
  }
}
