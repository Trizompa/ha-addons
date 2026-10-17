import { EditorState, Transaction, type ChangeSet, type StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { EdithaEditorPane, fromOtherPane, programmatic, type EditorTab } from './editor-pane.js';

/**
 * ED-17: colonna destra della vista divisa. Mostra una tab con uno stato "specchio":
 * il documento è lo stesso della tab (le modifiche passano da una colonna all'altra),
 * ma cursore, scorrimento e annulla sono propri. Così si possono affiancare due file
 * diversi o due punti dello stesso file. Il contenuto da salvare resta sempre quello
 * della tab (ED-4): questa colonna non lo conserva mai al posto suo.
 */
export class EdithaSidePane extends EdithaEditorPane {
  /** Crea lo stato specchio di una tab; lo fornisce l'app (linguaggio, preferenze, ascoltatori). */
  makeState: ((tab: EditorTab) => EditorState) | null = null;

  override firstUpdated(): void {
    const parent = this.renderRoot.querySelector('.host') as HTMLElement;
    this.view = new EditorView({
      parent,
      state: EditorState.create({ doc: '' }),
      dispatchTransactions: (trs, view) => {
        view.update(trs);
        const tab = this.current;
        if (!tab) return;
        for (const tr of trs) {
          if (tr.docChanged && !tr.annotation(fromOtherPane)) {
            this.dispatchEvent(new CustomEvent('side-change', { detail: { tab, changes: tr.changes } }));
          }
        }
      },
    });
  }

  override show(tab: EditorTab): void {
    if (this.current === tab || !this.view || !this.makeState) return;
    this.stash();
    this.current = tab;
    this.view.setState(this.makeState(tab));
    this.empty = false;
    const top = this.scrollTops.get(tab) ?? 0;
    const view = this.view;
    requestAnimationFrame(() => {
      if (this.current === tab) view.scrollDOM.scrollTop = top;
    });
  }

  /** Il documento della tab è cambiato altrove (ricarica dal disco, ripristino): si riallinea. */
  resync(tab: EditorTab): void {
    if (this.current !== tab || !this.view || !this.makeState) return;
    const top = this.view.scrollDOM.scrollTop;
    const state = this.makeState(tab);
    const head = Math.min(this.view.state.selection.main.head, state.doc.length);
    this.view.setState(state.update({ selection: { anchor: head } }).state);
    this.view.scrollDOM.scrollTop = top;
  }

  /**
   * Testo sostituito mentre la tab è visibile solo qui (ricarica dal disco, bozza recuperata):
   * la tab è già aggiornata; qui la modifica entra nella cronologia, così Annulla la riporta indietro.
   */
  replaceFromOutside(tab: EditorTab, changes: ChangeSet): boolean {
    if (this.current !== tab || !this.view) return false;
    this.view.dispatch({ changes, annotations: [fromOtherPane.of(true), programmatic.of(true)] });
    return true;
  }

  /** Modifiche fatte nella colonna sinistra sullo stesso file. */
  override applyRemote(tab: EditorTab, changes: ChangeSet): boolean {
    if (this.current !== tab || !this.view) return false;
    this.view.dispatch({
      changes,
      annotations: [fromOtherPane.of(true), Transaction.addToHistory.of(false)],
    });
    return true;
  }

  /** Impostazioni e linguaggio: valgono solo per la vista specchio, se mostra questa tab. */
  override apply(tab: EditorTab, effects: StateEffect<unknown>[]): void {
    if (effects.length && this.current === tab && this.view) this.view.dispatch({ effects });
  }

  /** Lo stato della tab non si tocca mai da qui: si ricorda solo lo scorrimento. */
  protected override stash(): void {
    if (this.current && this.view) this.scrollTops.set(this.current, this.view.scrollDOM.scrollTop);
  }
}

customElements.define('editha-side-pane', EdithaSidePane);
