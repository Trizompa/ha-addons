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
}

export const MAX_DRAFTS = 50;

export const draftSchema = {
  type: 'object',
  required: ['path', 'content', 'etag'],
  properties: {
    path: { type: 'string', minLength: 1, maxLength: 4096 },
    content: { type: 'string' },
    etag: { type: 'string', minLength: 1, maxLength: 128 },
  },
  additionalProperties: false,
} as const;

function isDraft(d: unknown): d is Draft {
  if (!d || typeof d !== 'object') return false;
  const r = d as Record<string, unknown>;
  return ['path', 'content', 'etag', 'savedAt'].every((k) => typeof r[k] === 'string');
}

/** Una bozza per file in /data/drafts: il nome è l'hash del percorso. */
export class DraftStore {
  /** Scrittura e cancellazione della stessa bozza in ordine di arrivo: una DELETE non viene superata da una PUT più lenta. */
  private readonly lock = new KeyedLock();

  constructor(
    readonly dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private fileOf(rel: string): string {
    return path.join(this.dir, createHash('sha256').update(rel).digest('hex') + '.json');
  }

  /** Bozze dalla più recente; quelle illeggibili vengono ignorate. */
  async list(): Promise<Draft[]> {
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
    return drafts.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  async put(rel: string, content: string, etag: string): Promise<Draft> {
    const draft: Draft = { path: rel, content, etag, savedAt: this.now().toISOString() };
    await this.lock.run(rel, async () => {
      await mkdir(this.dir, { recursive: true });
      await writeFileAtomic(this.fileOf(rel), Buffer.from(JSON.stringify(draft)));
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

  async remove(rel: string): Promise<void> {
    await this.lock.run(rel, () => rm(this.fileOf(rel), { force: true }));
  }
}
