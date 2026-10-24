import { LitElement, css, html } from 'lit';
import { Annotation, EditorState, Transaction, type ChangeSet, type StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { redo, undo } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { openLintPanel } from '@codemirror/lint';
import { snippet } from '@codemirror/autocomplete';
import type { Tab } from '../state/tabs.js';

export type EditorTab = Tab<EditorState>;

/** ED-17: modifica arrivata dall'altra colonna della vista divisa, da non rimandare indietro. */
export const fromOtherPane = Annotation.define<boolean>();
/** Testo cambiato da Editha e non dall'utente (ricarica dal disco, bozza recuperata). */
export const programmatic = Annotation.define<boolean>();

/**
 * Un'unica EditorView: ogni tab conserva il proprio EditorState (testo,
 * cronologia, selezione) e la vista mostra quello della tab attiva.
 * Chi chiede il contenuto di una tab lo riceve sempre dallo stato di quella tab,
 * mai da ciò che la vista sta mostrando (ED-4, FEP #19).
 */
export class EdithaEditorPane extends LitElement {
  static override properties = { empty: { type: Boolean, reflect: true } };
  declare empty: boolean;

  protected view: EditorView | null = null;
  protected current: EditorTab | null = null;
  protected readonly scrollTops = new WeakMap<EditorTab, number>();

  constructor() {
    super();
    this.empty = true;
  }

  static override styles = css`
    :host {
      position: relative;
      display: block;
      flex: 1;
      min-height: 0;
      background: var(--editor-bg);
    }
    .host {
      position: absolute;
      inset: 0;
    }
    :host([empty]) .host {
      visibility: hidden;
    }
    .host .cm-editor {
      height: 100%;
    }
    .host .cm-editor.cm-focused {
      outline: none;
    }
    /* Su iPhone, trascinando oltre il bordo sinistro, l'effetto elastico spostava anche la
       colonna dei numeri di riga: lo scorrimento si ferma ai bordi. */
    .host .cm-scroller {
      overscroll-behavior: none;
    }
    ::slotted(*) {
      position: absolute;
      inset: 0;
    }
    /* Su telefono la colonna dei numeri di riga si stringe per lasciare spazio al testo. */
    @media (max-width: 760px) {
      .host .cm-lineNumbers .cm-gutterElement {
        padding: 0 3px 0 6px !important;
        min-width: 0 !important;
      }
      .host .cm-foldGutter .cm-gutterElement {
        padding: 0 3px 0 0 !important;
      }
      .host .cm-fold-marker {
        width: 9px !important;
      }
      .host .cm-gutter-lint {
        width: 10px !important;
      }
      .host .cm-lint-marker {
        width: 8px !important;
        height: 8px !important;
        margin: 5px 1px !important;
      }
      .host .cm-content {
        padding-left: 2px;
      }
    }
  `;

  override firstUpdated(): void {
    const parent = this.renderRoot.querySelector('.host') as HTMLElement;
    this.view = new EditorView({ parent, state: EditorState.create({ doc: '' }) });
  }

  /** Mostra una tab: salva stato e scroll di quella uscente, ripristina quelli della nuova. */
  show(tab: EditorTab): void {
    const view = this.view;
    if (!view) return;
    if (this.current === tab) return;
    this.stash();
    this.current = tab;
    view.setState(tab.state);
    this.empty = false;
    const top = this.scrollTops.get(tab) ?? 0;
    requestAnimationFrame(() => {
      if (this.current === tab) view.scrollDOM.scrollTop = top;
    });
  }

  /** Nessuna tab aperta. */
  showEmpty(): void {
    this.stash();
    this.current = null;
    this.view?.setState(EditorState.create({ doc: '' }));
    this.empty = true;
  }

  /** Da chiamare prima di chiudere una tab: il suo stato non deve più cambiare. */
  detach(tab: EditorTab): void {
    if (this.current === tab) {
      this.stash();
      this.current = null;
    }
  }

  protected stash(): void {
    if (this.current && this.view) {
      this.current.state = this.view.state;
      this.scrollTops.set(this.current, this.view.scrollDOM.scrollTop);
    }
  }

  /** La tab mostrata in questo momento. */
  get shown(): EditorTab | null {
    return this.current;
  }

  /** Stato della vista (selezione, cronologia di annulla) della tab mostrata. */
  get viewState(): EditorState | null {
    return this.current && this.view ? this.view.state : null;
  }

  /** Stato aggiornato di una tab, che sia visibile o in secondo piano. */
  stateOf(tab: EditorTab): EditorState {
    return tab === this.current && this.view ? this.view.state : tab.state;
  }

  scrollTopOf(tab: EditorTab): number {
    return tab === this.current && this.view ? this.view.scrollDOM.scrollTop : (this.scrollTops.get(tab) ?? 0);
  }

  setScrollTop(tab: EditorTab, top: number): void {
    this.scrollTops.set(tab, top);
    if (tab === this.current && this.view) this.view.scrollDOM.scrollTop = top;
  }

  /** Applica effetti allo stato di una tab, anche se non è quella visibile. */
  apply(tab: EditorTab, effects: StateEffect<unknown>[]): void {
    if (effects.length === 0) return;
    if (tab === this.current && this.view) this.view.dispatch({ effects });
    else tab.state = tab.state.update({ effects }).state;
  }

  /**
   * Modifiche fatte sulla stessa tab nell'altra colonna. Restituisce false se la tab non è
   * visibile qui: in quel caso il suo stato è stato aggiornato in secondo piano.
   */
  applyRemote(tab: EditorTab, changes: ChangeSet): boolean {
    const spec = { changes, annotations: [fromOtherPane.of(true), Transaction.addToHistory.of(false)] };
    if (tab === this.current && this.view) {
      this.view.dispatch(spec);
      return true;
    }
    tab.state = tab.state.update(spec).state;
    return false;
  }

  /** Sostituisce il testo di una tab (es. ricarica dal disco) lasciando la modifica annullabile. */
  replaceDoc(tab: EditorTab, text: string): ChangeSet | null {
    const state = this.stateOf(tab);
    // Si cambia solo la parte diversa: cursore, pieghe e scorrimento restano dove sono.
    // Il testo nuovo segue i fine riga della tab (un file CRLF resta CRLF): niente filtro
    // dell'input, che altrimenti li cambierebbe solo nella parte diversa.
    const next = state.toText(state.lineBreak === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text);
    const a = state.doc.toString();
    const b = next.toString();
    if (a === b) return null;
    const max = Math.min(a.length, b.length);
    let start = 0;
    while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
    let end = 0;
    while (end < max - start && a.charCodeAt(a.length - 1 - end) === b.charCodeAt(b.length - 1 - end)) end++;
    const tr = state.update({
      changes: { from: start, to: a.length - end, insert: next.slice(start, b.length - end) },
      filter: false,
      annotations: programmatic.of(true),
    });
    if (tab === this.current && this.view) this.view.dispatch(tr);
    else tab.state = tr.state;
    return tr.changes;
  }

  command(name: 'undo' | 'redo' | 'search'): void {
    const view = this.view;
    if (!view || !this.current) return;
    if (name === 'undo') undo(view);
    else if (name === 'redo') redo(view);
    else openSearchPanel(view);
    view.focus();
  }

  /** Inserisce testo al posto della selezione (es. un entity_id). */
  insertText(text: string): boolean {
    const view = this.view;
    if (!view || !this.current || this.current.readOnly) return false;
    view.dispatch(view.state.replaceSelection(text), { scrollIntoView: true, userEvent: 'input' });
    view.focus();
    return true;
  }

  /** Mette `text` al posto dei `typed` caratteri prima del cursore (valore iniziato a scrivere). */
  replaceBefore(typed: number, text: string): boolean {
    const view = this.view;
    if (!view || !this.current || this.current.readOnly) return false;
    const { head, from, to } = view.state.selection.main;
    const start = from === to ? Math.max(view.state.doc.lineAt(head).from, head - typed) : from;
    view.dispatch({
      changes: { from: start, to, insert: text },
      selection: { anchor: start + text.length },
      scrollIntoView: true,
      userEvent: 'input',
    });
    view.focus();
    return true;
  }

  /**
   * Con `fields` i segnaposto ${...} diventano campi da percorrere con Tab.
   * Con \`fields\` i segnaposto \${...} diventano campi da percorrere con Tab.
   */
  insertBlock(text: string, fields: boolean): boolean {
    const view = this.view;
    if (!view || !this.current || this.current.readOnly) return false;
    const { from, to } = view.state.selection.main;
    const body = text.replace(/\n$/, '');
    if (fields) {
      snippet(body)(view, null, from, to);
    } else {
      const line = view.state.doc.lineAt(from);
      const indent = /^\s*/.exec(line.text)?.[0] ?? '';
      const insert = body.split('\n').join('\n' + indent);
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
        scrollIntoView: true,
        userEvent: 'input',
      });
    }
    view.focus();
    return true;
  }

  selectedText(): string {
    const view = this.view;
    if (!view || !this.current) return '';
    const { from, to } = view.state.selection.main;
    return view.state.sliceDoc(from, to);
  }

  /**
   * Selezione da salvare come snippet: a capo sempre \n, e la colonna d'inizio quando prima
   * della selezione sulla riga ci sono solo spazi (serve a togliere il rientro alle righe dopo).
   */
  selectionForSnippet(): { text: string; column: number } {
    const view = this.view;
    if (!view || !this.current) return { text: '', column: 0 };
    const { from, to } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    const before = view.state.doc.sliceString(line.from, from);
    return { text: view.state.doc.sliceString(from, to), column: /^\s*$/.test(before) ? before.length : 0 };
  }

  focusEditor(): void {
    if (this.current) this.view?.focus();
  }

  /** Seleziona un risultato della ricerca (riga e colonna da 1) e lo mostra al centro. */
  selectMatch(line: number, column: number, length: number): void {
    const view = this.view;
    if (!view || !this.current) return;
    const l = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
    const from = Math.min(l.from + column - 1, l.to);
    const to = Math.min(from + length, l.to);
    view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
  }

  /** Parola (o entity_id, con il punto) sotto il cursore. */
  wordAtCursor(): string {
    const view = this.view;
    if (!view || !this.current) return '';
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    const col = head - line.from;
    const before = /[\w.]*$/.exec(line.text.slice(0, col))![0];
    const after = /^[\w.]*/.exec(line.text.slice(col))![0];
    return (before + after).replace(/^\.+|\.+$/g, '');
  }

  /** Porta il cursore all'inizio di una riga (da 1) e la mostra al centro (o in alto). */
  goToLine(line: number, at: 'center' | 'start' = 'center'): void {
    const view = this.view;
    if (!view || !this.current) return;
    const n = Math.max(1, Math.min(line, view.state.doc.lines));
    const pos = view.state.doc.line(n).from;
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: at, yMargin: 8 }) });
    view.focus();
  }

  /** Pannello con l'elenco dei problemi del file; un clic porta alla riga. */
  openProblems(): void {
    if (this.view && this.current) openLintPanel(this.view);
  }

  /** Toglie il focus all'editor: su iPhone è l'unico modo per chiudere la tastiera. */
  blurEditor(): void {
    this.view?.contentDOM.blur();
  }

  override render() {
    return html`<div class="host"></div>
      <slot name="empty" ?hidden=${!this.empty}></slot>`;
  }
}

customElements.define('editha-editor-pane', EdithaEditorPane);
