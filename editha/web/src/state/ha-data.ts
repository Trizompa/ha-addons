import { api } from '../api/client.js';
import type { EntityInfo, ServiceInfo } from '../api/types.js';

type Listener = () => void;

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
  private timer: ReturnType<typeof setInterval> | undefined;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  async start(): Promise<void> {
    try {
      this.available = (await api.ha.status()).available;
    } catch {
      this.available = false;
    }
    if (!this.available) {
      this.loaded = true;
      this.notify();
      return;
    }
    await this.refresh();
    clearInterval(this.timer);
    this.timer = setInterval(() => void this.refresh(), 60_000);
  }

  async refresh(fresh = false): Promise<void> {
    if (!this.available) return;
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
