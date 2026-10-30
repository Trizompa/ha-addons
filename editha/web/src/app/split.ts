import type { ChangeSet, EditorState } from '@codemirror/state';
import type { ViewUpdate } from '@codemirror/view';
import { createEditorState, docText } from '../editor/setup.js';
import type { EdithaApp } from '../components/app.js';
import type { EditorTab } from '../components/editor-pane.js';

/** Vista divisa (ED-17): la colonna destra mostra una tab con cursore e annulla propri. */
export class SplitController {
  constructor(private readonly app: EdithaApp) {}

  /** Stato della colonna destra per una tab: stesso testo, cursore e annulla propri. */
  mirrorState(tab: EditorTab): EditorState {
    const canonical = this.app.pane.stateOf(tab);
    const sel = canonical.selection.main;
    return createEditorState({
      doc: docText(canonical),
      path: tab.path,
      readOnly: tab.readOnly,
      prefs: this.app.editorPrefs(),
      selection: { anchor: sel.anchor, head: sel.head },
      onUpdate: (update) => this.onSideUpdate(update),
    });
  }

  private onSideUpdate(update: ViewUpdate): void {
    if (update.focusChanged && update.view.hasFocus) this.app.sideFocused = true;
    // Ogni aggiornamento conta: anche i risultati del controllo YAML arrivano così, dopo una pausa.
    if (this.app.sideFocused) {
      this.app.refreshStatus();
      this.app.refreshToolbar();
    }
  }

  /** Modifica fatta a destra: arriva alla tab (che è ciò che si salva) e alla colonna sinistra. */
  onSideChange(e: CustomEvent<{ tab: EditorTab; changes: ChangeSet }>): void {
    const { tab, changes } = e.detail;
    if (this.app.tabs.find(tab.path) !== tab) return;
    if (this.app.pane.applyRemote(tab, changes)) return;
    // La tab non è visibile a sinistra: niente ascoltatori, si aggiorna qui.
    const saved = this.app.saved.get(tab);
    const dirty = !saved || !tab.state.doc.eq(saved);
    if (dirty !== tab.dirty) {
      tab.dirty = dirty;
      this.app.refreshTabs();
    }
    this.app.drafts.scheduleDraft(tab, 1000, true);
    this.app.ha.scheduleTemplate(tab);
  }

  async showInSide(tab: EditorTab): Promise<void> {
    if (this.app.narrow) return;
    this.app.split = true;
    // L'anteprima coprirebbe la colonna appena aperta.
    this.app.previewShown = false;
    await this.app.updateComplete;
    this.app.side?.show(tab);
    this.app.sideFocused = true;
    this.app.side?.focusEditor();
    this.app.refreshTabs();
    this.app.refreshStatus();
    this.app.session.scheduleSession();
  }

  async openInSide(path: string): Promise<void> {
    const tab = await this.app.loadTab(path, undefined, true, (err) =>
      this.app.toasts.show(this.app.openErrorText(path, err), 'error'),
    );
    if (tab) await this.showInSide(tab);
  }

  closeSplit(): void {
    if (!this.app.split) return;
    const side = this.app.side;
    const shown = side?.shown;
    if (side && shown) side.detach(shown);
    side?.showEmpty();
    this.app.split = false;
    this.app.sideFocused = false;
    this.app.refreshTabs();
    this.app.refreshStatus();
    this.app.session.scheduleSession();
    if (!this.app.touchQuery.matches) this.app.pane.focusEditor();
  }
}
