/** Serializza le operazioni sulla stessa chiave (es. due salvataggi dello stesso file). */
export class KeyedLock {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const current = previous.then(task, task);
    const tail = current.catch(() => undefined);
    this.tails.set(key, tail);
    try {
      return await current;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  /** Più chiavi insieme (es. origine e destinazione di uno spostamento), sempre nello stesso ordine. */
  runAll<T>(keys: string[], task: () => Promise<T>): Promise<T> {
    const sorted = [...new Set(keys)].sort();
    const step = (i: number): Promise<T> => (i === sorted.length ? task() : this.run(sorted[i]!, () => step(i + 1)));
    return step(0);
  }
}
