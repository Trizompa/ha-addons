/**
 * Stato della connessione con il server di Editha. Diventa "offline" quando le
 * richieste non arrivano (add-on in aggiornamento o riavvio, sessione Ingress
 * scaduta) e torna "online" alla prima risposta valida.
 */
class Connection extends EventTarget {
  online = true;

  report(online: boolean): void {
    if (online === this.online) return;
    this.online = online;
    this.dispatchEvent(new Event('change'));
  }
}

export const connection = new Connection();

/**
 * Risposta che non viene da Editha ma dal percorso verso Editha: proxy Ingress
 * senza add-on (502/503/504) o sessione Ingress scaduta (401). Le risposte di
 * Editha hanno sempre un corpo JSON con `error.code`.
 */
export function isPathFailure(status: number, data: unknown): boolean {
  const ours = !!(data as { error?: { code?: unknown } } | null)?.error?.code;
  if (ours) return false;
  return status === 401 || status === 502 || status === 503 || status === 504;
}
