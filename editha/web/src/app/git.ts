import { api, ApiError } from '../api/client.js';
import { t } from '../i18n/index.js';
import { docText } from '../editor/setup.js';
import { basename, dirname } from '../state/paths.js';
import type { EdithaApp } from '../components/app.js';
import type { EdithaGitPanel } from '../components/git-panel.js';

/** Collegamento tra il pannello Git e il resto di EDITHA: differenze, ripristino, aggiornamenti. */
export class GitController {
  constructor(private readonly app: EdithaApp) {}

  // ——— Git locale (GIT-1…6) ———

  async openGit(): Promise<void> {
    if (this.app.narrow) this.app.drawerOpen = true;
    else if (!this.app.settings.sidebarVisible) await this.app.updateSettings({ sidebarVisible: true });
    this.app.searchOpen = false;
    this.app.gitOpen = true;
    this.app.refreshToolbar();
    await this.app.updateComplete;
    const panel = this.app.renderRoot.querySelector('editha-git-panel') as EdithaGitPanel;
    panel.focusPanel();
    await panel.load();
  }

  private gitTimer: ReturnType<typeof setTimeout> | undefined;

  /** Con il pannello Git aperto, dopo un salvataggio lo stato dei file si rilegge (una volta sola). */
  scheduleGitRefresh(): void {
    if (!this.app.gitOpen) return;
    clearTimeout(this.gitTimer);
    this.gitTimer = setTimeout(() => {
      if (this.app.gitOpen) void (this.app.renderRoot.querySelector('editha-git-panel') as EdithaGitPanel).load(true);
    }, 400);
  }

  /** GIT-3: il file com'era nell'ultimo commit accanto a quello attuale (anche non salvato). */
  async openGitDiff(path: string, deleted: boolean): Promise<void> {
    let head: string | null;
    try {
      head = (await api.git.head(path)).content;
    } catch (err) {
      this.app.toasts.show(this.app.errorText(err), 'error');
      return;
    }
    const current = deleted ? { path, content: '' } : await this.app.compareSide(path);
    if (!current) return;
    if (this.app.narrow) this.app.drawerOpen = false;
    this.app.history = null;
    this.app.previewShown = false;
    this.app.compare = {
      left: { path, content: head ?? '', label: head === null ? t('git.diffNotInHead', { path }) : t('git.diffHead', { path }) },
      right: { ...current, label: deleted ? t('git.diffDeleted', { path }) : t('git.diffCurrent', { path }) },
    };
  }

  /** GIT-5: un file com'era in un commit accanto a quello attuale (vuoto se ora non c'è). */
  async openGitRevDiff(path: string, rev: string): Promise<void> {
    let old: string | null;
    try {
      old = (await api.git.show(path, rev)).content;
    } catch (err) {
      return void this.app.toasts.show(this.app.errorText(err), 'error');
    }
    const tab = this.app.tabs.find(path);
    let current: string | null;
    if (tab) current = docText(this.app.pane.stateOf(tab));
    else {
      try {
        current = (await api.read(path)).content;
      } catch (err) {
        if (!(err instanceof ApiError && err.code === 'not_found')) {
          return void this.app.toasts.show(this.app.openErrorText(path, err), 'error');
        }
        current = null;
      }
    }
    if (this.app.narrow) this.app.drawerOpen = false;
    this.app.history = null;
    this.app.previewShown = false;
    const short = rev.slice(0, 7);
    this.app.compare = {
      left: { path, content: old ?? '', label: t(old === null ? 'git.diffNotInRev' : 'git.diffRev', { path, rev: short }) },
      right: { path, content: current ?? '', label: t(current === null ? 'git.diffDeleted' : 'git.diffCurrent', { path }) },
    };
  }

  /**
   * GIT-6: riporta un file com'era in un commit, con conferma. Passa dal salvataggio di EDITHA:
   * il contenuto attuale resta nella sua cronologia; un file che ora non c'è viene ricreato.
   */
  async restoreFromGit(path: string, rev: string, subject: string): Promise<void> {
    const name = basename(path);
    const short = rev.slice(0, 7);
    const tab = this.app.tabs.find(path);
    const ok = await this.app.dialog.confirm({
      title: t('git.restoreTitle'),
      message: t('git.restoreMessage', { name, rev: short, subject }) + (tab?.dirty ? t('history.dirtyWarning') : ''),
      confirmLabel: t('git.restore'),
    });
    if (!ok) return;
    try {
      const content = (await api.git.show(path, rev)).content;
      if (content === null) throw new Error(t('git.restoreMissing'));
      let exists = true;
      let etag = '';
      try {
        etag = (await api.read(path)).etag;
      } catch (err) {
        if (!(err instanceof ApiError && err.code === 'not_found')) throw err;
        exists = false;
      }
      if (exists) await api.save(path, content, etag);
      else {
        // Le cartelle che nel frattempo sono state eliminate si ricreano.
        const parts = dirname(path).split('/').filter(Boolean);
        // L'albero si aggiorna dalla cartella sopra la prima ricreata (o da quella del file).
        let refreshFrom: string | null = null;
        for (let i = 1; i <= parts.length; i++) {
          const dir = parts.slice(0, i).join('/');
          await api.create(dir, 'directory').then(
            () => (refreshFrom ??= dirname(dir)),
            (err: unknown) => {
              if (!(err instanceof ApiError && err.code === 'already_exists')) throw err;
            },
          );
        }
        await api.create(path, 'file', content);
        await this.app.tree.refresh(refreshFrom ?? dirname(path));
      }
    } catch (err) {
      const error = err instanceof ApiError ? this.app.errorText(err) : (err as Error).message;
      return void this.app.toasts.show(t('history.failed', { name, error }), 'error');
    }
    // La tab aperta mostra il contenuto ripristinato; Annulla nell'editor lo riporta indietro.
    if (tab) await this.app.saver.reloadFromDisk(tab, true);
    this.scheduleGitRefresh();
    this.app.flash(t('git.restored', { name, rev: short }));
  }

  closeGit(): void {
    this.app.gitOpen = false;
    this.app.refreshToolbar();
    // Il focus torna dove si era partiti: il pulsante Git dell'esplora file.
    void this.app.updateComplete.then(() =>
      this.app.tree.shadowRoot?.querySelector<HTMLButtonElement>('button[data-action="git"]')?.focus(),
    );
  }

  /** Dopo un'operazione Git: messaggio e albero aggiornato (.gitignore nuovo, cartella .git). */
  async afterGitChange(message: string): Promise<void> {
    this.app.flash(message);
    await this.app.tree.refresh('');
    // Un .gitignore aperto (senza modifiche) mostra subito le righe aggiunte da Escludi.
    const ignore = this.app.tabs.find('.gitignore');
    if (ignore && !ignore.dirty) await this.app.saver.reloadFromDisk(ignore, true);
  }
}
