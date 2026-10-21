import type { EditorState, Text } from '@codemirror/state';
import { api, ApiError } from '../api/client.js';
import { t } from '../i18n/index.js';
import { docText } from '../editor/setup.js';
import { dirname } from '../state/paths.js';
import { forgetSecrets } from '../state/secrets.js';
import type { EdithaApp } from '../components/app.js';
import type { EditorTab } from '../components/editor-pane.js';

/** Salvataggio delle tab, conflitti con il file su disco e ricarica dal disco. */
export class SaveController {
  constructor(private readonly app: EdithaApp) {}

  // ——— salvataggio (ED-5, SEC-4) ———

  /** Salvataggi in corso: uno alla volta per tab, ognuno parte dall'etag del precedente. */
  private readonly saving = new Map<EditorTab, Promise<boolean>>();

  async save(tab: EditorTab | null = this.app.focusedTab()): Promise<boolean> {
    if (!tab || tab.readOnly) return false;
    // Niente da salvare: Ctrl+S su una tab pulita non deve proporre di sovrascrivere il file.
    if (!tab.dirty && !this.saving.has(tab)) return true;
    // Un secondo Ctrl+S mentre il primo è in viaggio aspetta: altrimenti partirebbe con
    // l'etag vecchio e il server lo scambierebbe per un conflitto.
    const previous = this.saving.get(tab) ?? Promise.resolve(true);
    const run = previous.then(
      () => this.saveNow(tab),
      () => this.saveNow(tab),
    );
    this.saving.set(tab, run);
    try {
      return await run;
    } finally {
      if (this.saving.get(tab) === run) this.saving.delete(tab);
    }
  }

  private async saveNow(tab: EditorTab): Promise<boolean> {
    if (this.app.tabs.find(tab.path) !== tab) return false;
    const state = this.app.pane.stateOf(tab);
    const doc = state.doc;
    try {
      const res = await api.save(tab.path, docText(state), tab.etag);
      this.markSaved(tab, doc, res.etag);
      if (tab.name === 'secrets.yaml') forgetSecrets();
      this.app.flash(t('save.done', { name: tab.name }));
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === 'conflict') return this.resolveConflict(tab, err);
      if (err instanceof ApiError && err.code === 'not_found') return this.recreateOnSave(tab, state);
      this.app.toasts.show(t('save.failed', { name: tab.name, error: this.app.errorText(err) }), 'error');
      return false;
    }
  }

  /** Il file è stato rinominato o eliminato da un'altra parte mentre era aperto qui. */
  private async recreateOnSave(tab: EditorTab, state: EditorState): Promise<boolean> {
    const choice = await this.app.dialog.choose({
      title: t('save.missingTitle'),
      message: t('save.missing', { name: tab.path }),
      choices: [
        { id: 'cancel', label: t('common.cancel') },
        { id: 'recreate', label: t('drafts.recreate'), variant: 'primary' },
      ],
      defaultId: 'recreate',
    });
    if (choice !== 'recreate') return false;
    try {
      await api.create(tab.path, 'file', docText(state));
      const file = await api.read(tab.path);
      this.markSaved(tab, state.doc, file.etag);
    } catch (err) {
      this.app.toasts.show(t('save.failed', { name: tab.name, error: this.app.errorText(err) }), 'error');
      return false;
    }
    this.app.git.scheduleGitRefresh();
    await this.app.tree.refresh(dirname(tab.path));
    this.app.flash(t('save.done', { name: tab.name }));
    return true;
  }

  markSaved(tab: EditorTab, doc: Text, etag: string): void {
    this.app.git.scheduleGitRefresh();
    tab.etag = etag;
    this.app.saved.set(tab, doc);
    tab.dirty = !this.app.pane.stateOf(tab).doc.eq(doc);
    this.app.refreshTabs();
    // Salvato quello che c'era nella bozza: se nel frattempo si è scritto ancora, la bozza si aggiorna.
    if (tab.dirty) this.app.drafts.scheduleDraft(tab);
    else {
      this.app.drafts.dropDraft(tab.path, tab);
      // Salvato: la prossima modifica richiede cosa fare della bozza vecchia ancora in sospeso.
      const deferred = this.app.drafts.deferredDrafts.get(tab.path);
      if (deferred) deferred.asked = false;
    }
  }

  /** Il file è cambiato su disco dopo l'apertura: decide l'utente. */
  private async resolveConflict(tab: EditorTab, err: ApiError): Promise<boolean> {
    const choice = await this.app.dialog.choose({
      title: t('conflict.title'),
      message: t('conflict.message', { name: tab.name }),
      choices: [
        { id: 'cancel', label: t('common.cancel') },
        { id: 'reload', label: t('conflict.reload') },
        { id: 'overwrite', label: t('conflict.overwrite'), variant: 'danger' },
      ],
      defaultId: 'cancel',
    });
    if (choice === 'overwrite') {
      tab.etag = String(err.details.etag ?? tab.etag);
      // Già dentro il salvataggio in corso: si riprova direttamente, senza mettersi in coda.
      return this.saveNow(tab);
    }
    if (choice === 'reload') {
      await this.reloadFromDisk(tab);
    }
    return false;
  }

  async reloadFromDisk(tab: EditorTab, quiet = false): Promise<void> {
    const before = this.app.pane.stateOf(tab).doc;
    try {
      const file = await api.read(tab.path);
      // Ricarica automatica (dopo una sostituzione, un caricamento, un ripristino): se intanto si
      // è scritto nella tab, il testo resta; al salvataggio l'etag vecchio farà chiedere cosa fare.
      if (quiet && !this.app.pane.stateOf(tab).doc.eq(before)) return;
      this.app.replaceDoc(tab, file.content);
      this.markSaved(tab, this.app.pane.stateOf(tab).doc, file.etag);
      if (!quiet) this.app.toasts.show(t('conflict.reloaded', { name: tab.name }), 'info');
    } catch (err) {
      this.app.toasts.show(this.app.openErrorText(tab.path, err), 'error');
    }
  }

  async saveAll(): Promise<void> {
    let n = 0;
    for (const tab of this.app.tabs.tabs.filter((t) => t.dirty && !t.readOnly)) {
      if (!(await this.save(tab))) return;
      n++;
    }
    if (n > 1) this.app.flash(t('save.doneMany', { n }));
  }
}
