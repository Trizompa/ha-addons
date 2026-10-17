import { basename, isWithin, rebase } from './paths.js';

export interface Tab<S> {
  path: string;
  name: string;
  /** Etag dell'ultima versione letta o salvata: serve al controllo dei conflitti. */
  etag: string;
  readOnly: boolean;
  /** Stato dell'editor (documento, cronologia, selezione) di questa tab. */
  state: S;
  dirty: boolean;
}

/**
 * Elenco delle tab e tab attiva. Logica pura, senza DOM: la tab attiva
 * dopo una chiusura si decide solo qui (ED-4, FEP #19).
 */
export class TabsModel<S> {
  private list: Tab<S>[] = [];
  private activeIndex = -1;

  get tabs(): readonly Tab<S>[] {
    return this.list;
  }

  get active(): Tab<S> | null {
    return this.list[this.activeIndex] ?? null;
  }

  find(path: string): Tab<S> | undefined {
    return this.list.find((t) => t.path === path);
  }

  /** Apre una tab dopo quella attiva e la attiva; se esiste già la attiva soltanto. */
  open(tab: Tab<S>): Tab<S> {
    const existing = this.list.findIndex((t) => t.path === tab.path);
    if (existing !== -1) {
      this.activeIndex = existing;
      return this.list[existing]!;
    }
    const at = this.activeIndex === -1 ? this.list.length : this.activeIndex + 1;
    this.list.splice(at, 0, tab);
    this.activeIndex = at;
    return tab;
  }

  /** Inserisce una tab dopo quella attiva senza attivarla (chi apre decide se mostrarla). */
  insert(tab: Tab<S>): Tab<S> {
    const existing = this.find(tab.path);
    if (existing) return existing;
    const at = this.activeIndex === -1 ? this.list.length : this.activeIndex + 1;
    this.list.splice(at, 0, tab);
    if (this.activeIndex >= at) this.activeIndex++;
    return tab;
  }

  /** Aggiunge una tab in fondo senza cambiare quella attiva (ripristino della sessione). */
  append(tab: Tab<S>): Tab<S> {
    const existing = this.find(tab.path);
    if (existing) return existing;
    this.list.push(tab);
    return tab;
  }

  activate(path: string): Tab<S> | null {
    const i = this.list.findIndex((t) => t.path === path);
    if (i !== -1) this.activeIndex = i;
    return this.active;
  }

  /**
   * Chiude una tab. Se era attiva diventa attiva quella alla sua destra,
   * o in mancanza quella a sinistra. Restituisce la nuova tab attiva.
   */
  close(path: string): Tab<S> | null {
    const i = this.list.findIndex((t) => t.path === path);
    if (i === -1) return this.active;
    this.list.splice(i, 1);
    if (this.list.length === 0) this.activeIndex = -1;
    else if (i < this.activeIndex) this.activeIndex -= 1;
    else if (i === this.activeIndex) this.activeIndex = Math.min(i, this.list.length - 1);
    return this.active;
  }

  /** Aggiorna le tab dopo la rinomina di un file o di una cartella. */
  rename(from: string, to: string): Tab<S>[] {
    const changed: Tab<S>[] = [];
    for (const tab of this.list) {
      if (isWithin(tab.path, from) && from !== '') {
        tab.path = rebase(tab.path, from, to);
        tab.name = basename(tab.path);
        changed.push(tab);
      }
    }
    return changed;
  }

  /** Tab che stanno dentro `path` (il file stesso o i file di una cartella). */
  within(path: string): Tab<S>[] {
    return this.list.filter((t) => isWithin(t.path, path));
  }

  /** Sposta una tab in un'altra posizione mantenendo la stessa tab attiva. */
  move(path: string, toIndex: number): void {
    const from = this.list.findIndex((t) => t.path === path);
    if (from === -1) return;
    const active = this.active;
    const [tab] = this.list.splice(from, 1);
    this.list.splice(Math.max(0, Math.min(toIndex, this.list.length)), 0, tab!);
    this.activeIndex = active ? this.list.indexOf(active) : -1;
  }
}
