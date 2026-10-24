/** Serializza le operazioni sulla stessa chiave (es. due salvataggi dello stesso file). */
export class KeyedLock {
    constructor() {
        this.tails = new Map();
    }
    async run(key, task) {
        const previous = this.tails.get(key) ?? Promise.resolve();
        const current = previous.then(task, task);
        const tail = current.catch(() => undefined);
        this.tails.set(key, tail);
        try {
            return await current;
        }
        finally {
            if (this.tails.get(key) === tail)
                this.tails.delete(key);
        }
    }
    /** Più chiavi insieme (es. origine e destinazione di uno spostamento), sempre nello stesso ordine. */
    runAll(keys, task) {
        const sorted = [...new Set(keys)].sort();
        const step = (i) => (i === sorted.length ? task() : this.run(sorted[i], () => step(i + 1)));
        return step(0);
    }
}
