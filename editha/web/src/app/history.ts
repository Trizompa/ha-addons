import { api, ApiError } from '../api/client.js';
import { getLang, t } from '../i18n/index.js';
import { docText } from '../editor/setup.js';
import { basename, dirname } from '../state/paths.js';
import type { EdithaApp } from '../components/app.js';
import { formatVersionDate, type EdithaHistoryPanel } from '../components/history-panel.js';
import type { EdithaHistorySpace } from '../components/history-space.js';

/** Cronologia dei file (BK-2…BK-4, BK-7): apertura, chiusura, ripristino di una versione, spazio occupato. */
export class HistoryController {
  constructor(private readonly app: EdithaApp) {}

  /** Versioni eliminate: la cronologia aperta di un file ricarica il suo elenco. */
  async afterHistoryPruned(): Promise<void> {
    const panel = this.app.renderRoot.querySelector<EdithaHistoryPanel>('editha-history-panel');
    if (panel && this.app.history) await panel.reload(this.app.history.current);
  }

  /**
   * BK-1: un file o una cartella eliminati tornano al loro posto, dopo una conferma. Se lì c'è già
   * qualcosa con lo stesso nome il server non tocca niente e lo si dice.
   */
  async restoreDeleted(item: { path: string; kind: 'file' | 'directory'; newest: string }): Promise<void> {
    const when = new Date(item.newest);
    const lang = getLang();
    const ok = await this.app.dialog.confirm({
      title: item.kind === 'directory' ? t('restore.folderTitle') : t('restore.fileTitle'),
      message: t(item.kind === 'directory' ? 'restore.folderMessage' : 'restore.fileMessage', {
        name: item.path,
        date: new Intl.DateTimeFormat(lang, { dateStyle: 'short' }).format(when),
        time: new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(when),
      }),
      confirmLabel: t('restore.confirm'),
    });
    if (!ok) return;
    try {
      await api.restoreDeleted(item.path);
      this.app.toasts.show(t('restore.done', { name: item.path }), 'info');
      await this.app.tree.refresh(dirname(item.path));
    } catch (err) {
      this.app.toasts.show(
        err instanceof ApiError && err.code === 'already_exists'
          ? t('restore.exists', { name: item.path })
          : t('restore.failed', { name: item.path, error: this.app.errorText(err) }),
        'error',
      );
    }
    await (this.app.renderRoot.querySelector('editha-history-space') as EdithaHistorySpace).reload();
  }

  /** BK-7: spazio occupato dalla cronologia. */
  openHistorySpace(): Promise<void> {
    return (this.app.renderRoot.querySelector('editha-history-space') as EdithaHistorySpace).show();
  }


  // ——— cronologia: confronto e ripristino (BK-2, BK-3, BK-4) ———

  async openHistory(path: string): Promise<void> {
    const tab = this.app.tabs.find(path);
    let current: string;
    let readOnly: boolean;
    if (tab) {
      current = docText(this.app.pane.stateOf(tab));
      readOnly = tab.readOnly;
    } else {
      try {
        const file = await api.read(path);
        current = file.content;
        readOnly = file.readOnly;
      } catch (err) {
        this.app.toasts.show(this.app.openErrorText(path, err), 'error');
        return;
      }
    }
    if (this.app.narrow) this.app.drawerOpen = false;
    this.app.previewShown = false;
    this.app.history = { path, current, readOnly };
  }

  closeHistory(): void {
    this.app.history = null;
    // Modifiche fatte mentre la cronologia copriva l'editor: l'anteprima si rimette in pari.
    this.app.ha.scheduleTemplate(null);
    if (!this.app.touchQuery.matches) this.app.pane.focusEditor();
  }

  async restoreVersion(id: string, createdAt: string): Promise<void> {
    if (!this.app.history) return;
    const { path } = this.app.history;
    const name = basename(path);
    const date = formatVersionDate(createdAt);
    const tab = this.app.tabs.find(path);
    const ok = await this.app.dialog.confirm({
      title: t('history.confirmTitle'),
      message: t('history.confirmMessage', { name, date }) + (tab?.dirty ? t('history.dirtyWarning') : ''),
      confirmLabel: t('history.restore'),
    });
    if (!ok) return;
    try {
      await api.restore(path, id);
    } catch (err) {
      this.app.toasts.show(t('history.failed', { name, error: this.app.errorText(err) }), 'error');
      return;
    }
    // La tab aperta mostra il contenuto ripristinato; Annulla nell'editor lo riporta indietro.
    if (tab) await this.app.saver.reloadFromDisk(tab, true);
    this.app.history = null;
    if (tab) this.app.activate(tab.path);
    this.app.flash(t('history.restored', { date }));
  }
}
