import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { writeFileAtomic } from '../fs/atomic.js';
import { KeyedLock } from '../fs/lock.js';
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
};
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
};
export const aliveSchema = {
    type: 'object',
    required: ['client'],
    properties: {
        client: { type: 'string', minLength: 1, maxLength: 64 },
        closing: { type: 'boolean' },
    },
    additionalProperties: false,
};
function isDraft(d) {
    if (!d || typeof d !== 'object')
        return false;
    const r = d;
    return (['path', 'content', 'etag', 'savedAt'].every((k) => typeof r[k] === 'string') &&
        (r.client === undefined || typeof r.client === 'string'));
}
/**
 * Una bozza per file e per finestra in /data/drafts (il nome è l'hash di percorso e finestra):
 * due finestre aperte sullo stesso file non si sovrascrivono le bozze a vicenda.
 */
export class DraftStore {
    constructor(dir, now = () => new Date()) {
        this.dir = dir;
        this.now = now;
        /** Scrittura e cancellazione della stessa bozza in ordine di arrivo: una DELETE non viene superata da una PUT più lenta. */
        this.lock = new KeyedLock();
        /** Ultimo segnale di ogni finestra aperta (solo in memoria: dopo un riavvio si riparte da zero). */
        this.seen = new Map();
        /** Finestre che hanno detto di chiudersi (dopo l'avvio non vanno considerate aperte). */
        this.closed = new Set();
        this.startedAt = now().getTime();
    }
    fileOf(rel, client) {
        // Senza finestra (bozze di versioni precedenti) il nome resta quello di prima.
        const key = client ? `${rel}\0${client}` : rel;
        return path.join(this.dir, createHash('sha256').update(key).digest('hex') + '.json');
    }
    /** La finestra è ancora aperta (`closing`: si sta chiudendo). */
    alive(client, closing = false) {
        if (closing) {
            this.seen.delete(client);
            this.closed.add(client);
        }
        else {
            this.seen.set(client, this.now().getTime());
            this.closed.delete(client);
        }
        // Le finestre sparite da tempo non servono più; finito il periodo dopo l'avvio, nemmeno le chiuse.
        if (this.now().getTime() - this.startedAt >= LIVE_MS)
            this.closed.clear();
        const old = this.now().getTime() - LIVE_MS;
        for (const [c, t] of this.seen)
            if (t < old)
                this.seen.delete(c);
    }
    /** Ultimo segnale della finestra; per una sconosciuta subito dopo l'avvio, l'avvio stesso. */
    lastSeen(client) {
        if (!client)
            return undefined;
        const t = this.seen.get(client);
        if (t !== undefined)
            return t;
        return this.now().getTime() - this.startedAt < LIVE_MS && !this.closed.has(client) ? this.startedAt : undefined;
    }
    isLive(client) {
        const t = this.lastSeen(client);
        return t !== undefined && this.now().getTime() - t < LIVE_MS;
    }
    /** Bozze dalla più recente; quelle illeggibili vengono ignorate. */
    async list() {
        let names;
        try {
            names = await readdir(this.dir);
        }
        catch {
            return [];
        }
        const drafts = [];
        for (const name of names.filter((n) => n.endsWith('.json'))) {
            try {
                const raw = JSON.parse(await readFile(path.join(this.dir, name), 'utf8'));
                if (isDraft(raw))
                    drafts.push(raw);
            }
            catch {
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
    async put(rel, content, etag, client) {
        const draft = { path: rel, content, etag, savedAt: this.now().toISOString(), ...(client ? { client } : {}) };
        const file = this.fileOf(rel, client);
        await this.lock.run(file, async () => {
            await mkdir(this.dir, { recursive: true });
            await writeFileAtomic(file, Buffer.from(JSON.stringify(draft)));
        });
        await this.prune();
        return draft;
    }
    /** Oltre MAX_DRAFTS si eliminano le bozze più vecchie (per data del file, senza leggerle). */
    async prune() {
        const names = (await readdir(this.dir)).filter((n) => n.endsWith('.json'));
        if (names.length <= MAX_DRAFTS)
            return;
        const dated = await Promise.all(names.map(async (n) => ({ n, t: await stat(path.join(this.dir, n)).then((s) => s.mtimeMs, () => 0) })));
        dated.sort((a, b) => b.t - a.t);
        for (const { n } of dated.slice(MAX_DRAFTS))
            await rm(path.join(this.dir, n), { force: true });
    }
    async remove(rel, client) {
        const file = this.fileOf(rel, client);
        await this.lock.run(file, () => rm(file, { force: true }));
    }
    /**
     * Una finestra recupera la bozza di un'altra (`from`; assente per le bozze di versioni
     * precedenti): la bozza passa a lei e sparisce dall'originale, tutto sotto lo stesso blocco.
     * Se due finestre la chiedono insieme, solo la prima la ottiene; l'altra riceve null.
     */
    async claim(rel, from, to) {
        const source = this.fileOf(rel, from);
        const target = this.fileOf(rel, to);
        // Origine e destinazione insieme, sempre nello stesso ordine: niente stalli.
        return this.lock.runAll([source, target], async () => {
            let raw;
            try {
                raw = JSON.parse(await readFile(source, 'utf8'));
            }
            catch {
                return null;
            }
            if (!isDraft(raw) || raw.path !== rel)
                return null;
            const draft = { ...raw, client: to };
            if (source !== target) {
                await writeFileAtomic(target, Buffer.from(JSON.stringify(draft)));
                await rm(source, { force: true });
            }
            return draft;
        });
    }
}
