import { api } from '../api/client.js';
import { connection } from '../api/connection.js';
import { t } from '../i18n/index.js';
import type { EdithaApp } from '../components/app.js';

/** Server che non risponde o add-on aggiornato: si riprova da soli e si ricarica la pagina. */
export class ServerController {
  constructor(private readonly app: EdithaApp) {}

  /** Build del server all'apertura della pagina: se cambia, l'add-on è stato aggiornato. */
  build: string | null = null;
  private healthTimer: ReturnType<typeof setInterval> | undefined;

  readonly onConnection = () => {
    if (!connection.online) {
      this.app.offline = true;
      clearInterval(this.healthTimer);
      // Si riprova da soli: quando il server torna, il banner sparisce.
      this.healthTimer = setInterval(() => void this.checkHealth(), 4000);
    }
  };

  private async checkHealth(): Promise<void> {
    let build: string;
    try {
      build = (await api.health()).build;
    } catch {
      return;
    }
    clearInterval(this.healthTimer);
    // Le bozze che non sono partite mentre Editha non rispondeva si scrivono adesso.
    void this.app.drafts.writeAllDrafts();
    if (this.build && build !== this.build) {
      this.app.addonUpdated = true;
      return;
    }
    this.app.offline = false;
    this.app.toasts.show(t('conn.restored'), 'success');
  }

  /** Ricarica dal banner: prima le bozze; senza server le modifiche andrebbero perse, e lo si dice. */
  async reloadPage(): Promise<void> {
    if (this.app.tabs.tabs.some((tab) => tab.dirty)) {
      if (this.app.offline && !this.app.addonUpdated) {
        const ok = await this.app.dialog.confirm({
          title: t('conn.reload'),
          message: t('conn.reloadOffline'),
          confirmLabel: t('conn.reload'),
          danger: true,
        });
        if (!ok) return;
      } else {
        await this.app.drafts.writeAllDrafts();
      }
    }
    location.reload();
  }

  /** Elemento staccato dalla pagina: niente più tentativi di ricollegarsi. */
  stop(): void {
    clearInterval(this.healthTimer);
  }
}
