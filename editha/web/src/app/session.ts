import { api, ApiError } from '../api/client.js';
import type { Session } from '../api/types.js';
import { t } from '../i18n/index.js';
import type { EdithaApp } from '../components/app.js';
import { PERMANENT_OPEN_ERRORS } from './drafts.js';

/** Tab aperte, cursori e colonna destra: ripristinati all'avvio e salvati sul server. */
export class SessionController {
  constructor(private readonly app: EdithaApp) {}

  // ——— sessione (ED-11, FEP #13) ———

  private sessionTimer: ReturnType<typeof setTimeout> | undefined;
  /** Sessione letta all'avvio: da qui in poi la si può salvare. */
  sessionReady = false;

  async restoreSession(): Promise<void> {
    let session: Session;
    try {
      session = await api.session();
    } catch {
      // Sessione non letta: non la si sovrascrive con una vuota (sessionReady resta false).
      return;
    }
    const missing: string[] = [];
    for (const saved of session.tabs) {
      let failure: unknown = null;
      const tab = await this.app.loadTab(saved.path, { anchor: saved.anchor, head: saved.head }, true, (err) => (failure = err));
      if (tab) this.app.pane.setScrollTop(tab, saved.scrollTop);
      else {
        missing.push(saved.path);
        // Un errore passeggero (Editha non risponde) non toglie il file dalla sessione.
        if (!(failure instanceof ApiError && PERMANENT_OPEN_ERRORS.has(failure.code))) this.unrestored.push(saved);
      }
    }
    const active = (session.active && this.app.tabs.find(session.active)) || this.app.tabs.tabs[0];
    if (active) this.app.activate(active.path);
    const side = session.side ? this.app.tabs.find(session.side) : undefined;
    if (side && !this.app.narrow) await this.app.showInSide(side);
    if (missing.length) {
      this.app.toasts.show(
        missing.length === 1
          ? t('session.missingOne', { name: missing[0]! })
          : t('session.missingMany', { n: missing.length }),
        'warning',
      );
    }
    this.sessionReady = true;
    this.scheduleSession();
  }

  scheduleSession(): void {
    if (!this.sessionReady) return;
    clearTimeout(this.sessionTimer);
    this.sessionTimer = setTimeout(() => void this.saveSession(), 600);
  }

  /** Tab della sessione che all'avvio non si sono aperte per un errore passeggero. */
  private unrestored: Session['tabs'] = [];

  async saveSession(): Promise<void> {
    const open = this.app.tabs.tabs.map((tab) => {
      const sel = this.app.pane.stateOf(tab).selection.main;
      return { path: tab.path, anchor: sel.anchor, head: sel.head, scrollTop: this.app.pane.scrollTopOf(tab) };
    });
    const kept = this.unrestored.filter((u) => !this.app.tabs.find(u.path));
    const session: Session = {
      tabs: [...open, ...kept].slice(0, 50),
      active: this.app.tabs.active?.path ?? null,
      side: this.app.split ? (this.app.side?.shown?.path ?? null) : null,
    };
    try {
      await api.saveSession(session);
    } catch {
      // La sessione è una comodità: un errore qui non va segnalato a ogni modifica.
    }
  }
}
