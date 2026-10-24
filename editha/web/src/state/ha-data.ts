import { api } from '../api/client.js';
import type { EntityInfo, ServiceInfo } from '../api/types.js';

type Listener = () => void;

const NO_IDS: ReadonlySet<string> = new Set();

/**
 * Entità e servizi di Home Assistant condivisi tra autocompletamento e pannello
 * "Inserisci". Si aggiornano all'avvio, ogni minuto e su richiesta.
 */
class HaData {
  available = false;
  entities: EntityInfo[] = [];
  services: ServiceInfo[] = [];
  loaded = false;
  private readonly listeners = new Set<Listener>();
  private idsFor: EntityInfo[] | null = null;
  private ids: ReadonlySet<string> = NO_IDS;

  /**
   * Id delle entità, per l'avviso sulle entità sconosciute. Vuoto se HA non è raggiungibile:
   * senza l'elenco non si può dire che un'entità non esiste. Lo stesso Set finché i dati non cambiano.
   */
  entityIds(): ReadonlySet<string> {
    if (!this.available) return NO_IDS;
    if (this.idsFor !== this.entities) {
      this.idsFor = this.entities;
      // Dati ricaricati ogni minuto: se gli id sono gli stessi resta lo stesso Set (niente nuovo controllo).
      const ids = new Set(this.entities.map((e) => e.entity_id));
      if (ids.size !== this.ids.size || [...ids].some((id) => !this.ids.has(id))) this.ids = ids;
    }
    return this.ids;
  }
  private timer: ReturnType<typeof setInterval> | undefined;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  private starting: Promise<void> | null = null;

  /** Controlla se HA è raggiungibile e carica i dati; se non lo è, riprova al giro successivo. */
  start(): Promise<void> {
    this.starting ??= this.connect().finally(() => (this.starting = null));
    return this.starting;
  }

  private async connect(): Promise<void> {
    try {
      this.available = (await api.ha.status()).available;
    } catch {
      this.available = false;
    }
    // Anche se ora HA non risponde: ogni minuto si riprova (refresh richiama start).
    clearInterval(this.timer);
    this.timer = setInterval(() => void this.refresh(), 60_000);
    if (!this.available) {
      this.loaded = true;
      this.notify();
      return;
    }
    await this.load(false);
  }

  /** Aggiorna entità e servizi; se HA non era raggiungibile, prima ricontrolla (pulsante Aggiorna). */
  async refresh(fresh = false): Promise<void> {
    if (!this.available) return this.start();
    await this.load(fresh);
  }

  private async load(fresh: boolean): Promise<void> {
    try {
      const [e, s] = await Promise.all([api.ha.entities(fresh), api.ha.services(fresh)]);
      this.entities = e.entities;
      this.services = s.services;
    } catch {
      // Dati precedenti ancora validi: l'autocompletamento resta utilizzabile.
    }
    this.loaded = true;
    this.notify();
  }
}

export const haData = new HaData();
