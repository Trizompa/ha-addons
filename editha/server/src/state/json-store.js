import { readFile } from 'node:fs/promises';
import { writeFileAtomic } from '../fs/atomic.js';
import { KeyedLock } from '../fs/lock.js';
/**
 * Documento JSON in /data, scritto in modo atomico. Un file mancante o illeggibile
 * vale come valori predefiniti: un'impostazione rovinata non deve bloccare l'editor.
 */
export class JsonStore {
    constructor(file, defaults, 
    /** Tiene solo i campi validi di un documento letto da disco. */
    sanitize) {
        this.file = file;
        this.defaults = defaults;
        this.sanitize = sanitize;
        this.lock = new KeyedLock();
    }
    async get() {
        try {
            const raw = JSON.parse(await readFile(this.file, 'utf8'));
            return { ...this.defaults, ...this.sanitize(raw) };
        }
        catch {
            return { ...this.defaults };
        }
    }
    async set(value) {
        return this.lock.run(this.file, async () => {
            await writeFileAtomic(this.file, Buffer.from(JSON.stringify(value, null, 2) + '\n'));
            return value;
        });
    }
    /** Aggiorna solo i campi indicati. */
    async patch(changes) {
        return this.lock.run(this.file + '#patch', async () => this.set({ ...(await this.get()), ...changes }));
    }
}
