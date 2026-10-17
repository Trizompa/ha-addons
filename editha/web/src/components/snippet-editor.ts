import { LitElement, css, html, nothing } from 'lit';
import type { Snippet } from '../api/types.js';
import { t } from '../i18n/index.js';
import { sharedStyles } from '../ui/shared-styles.js';

interface Pending {
  snippet: Snippet;
  resolve: (result: { name: string; body: string } | null) => void;
}

/** Finestra per modificare nome e testo di uno snippet personale. */
export class EdithaSnippetEditor extends LitElement {
  static override properties = { pending: { state: true }, error: { state: true } };
  declare pending: Pending | null;
  declare error: string | null;

  constructor() {
    super();
    this.pending = null;
    this.error = null;
  }

  static override styles = [
    sharedStyles,
    css`
      dialog {
        width: min(620px, calc(100vw - 32px));
        padding: 0;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        background: var(--surface);
        color: var(--text);
        box-shadow: var(--shadow-pop);
      }
      dialog::backdrop {
        background: var(--scrim);
        backdrop-filter: blur(2px);
      }
      form {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 18px 20px;
      }
      h2 {
        margin: 0 0 4px;
        font-size: 16px;
      }
      label {
        font-size: 12px;
        color: var(--text-muted);
      }
      textarea {
        min-height: 220px;
        max-height: 55vh;
        padding: 10px;
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-sm);
        background: var(--editor-bg);
        color: var(--text);
        font: 13px/1.5 var(--font-code);
        tab-size: 2;
        resize: vertical;
        white-space: pre;
      }
      .error {
        color: var(--danger);
        font-size: 12px;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 4px;
      }
    `,
  ];

  /** Apre la finestra; restituisce nome e testo nuovi, o null se annullato. */
  edit(snippet: Snippet): Promise<{ name: string; body: string } | null> {
    this.pending?.resolve(null);
    return new Promise((resolve) => {
      this.error = null;
      this.pending = { snippet, resolve };
      void this.updateComplete.then(() => {
        const dialog = this.renderRoot.querySelector('dialog')!;
        if (!dialog.open) dialog.showModal();
        (this.renderRoot.querySelector('textarea') as HTMLTextAreaElement | null)?.focus();
      });
    });
  }

  private finish(result: { name: string; body: string } | null): void {
    const pending = this.pending;
    this.pending = null;
    (this.renderRoot.querySelector('dialog') as HTMLDialogElement | null)?.close();
    pending?.resolve(result);
  }

  private submit(e: Event): void {
    e.preventDefault();
    const name = (this.renderRoot.querySelector('input') as HTMLInputElement).value.trim();
    const body = (this.renderRoot.querySelector('textarea') as HTMLTextAreaElement).value;
    if (!name) return void (this.error = t('name.empty'));
    if (name.length > 120) return void (this.error = t('name.tooLong'));
    if (!body.trim()) return void (this.error = t('snippet.emptyBody'));
    if (body.length > 20000) return void (this.error = t('snippet.tooLong'));
    this.finish({ name, body });
  }

  /**
   * Tab nel testo inserisce due spazi invece di spostare il focus (gli snippet sono YAML);
   * con del testo selezionato rientra di due spazi le righe selezionate, senza cancellarle.
   */
  private onKey(e: KeyboardEvent): void {
    if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    const area = e.target as HTMLTextAreaElement;
    const { selectionStart: start, selectionEnd: end, value } = area;
    if (start === end) {
      area.setRangeText('  ', start, end, 'end');
      return;
    }
    const blockStart = value.lastIndexOf('\n', start - 1) + 1;
    // Una selezione che finisce all'inizio di una riga non comprende quella riga.
    const last = end > blockStart && value[end - 1] === '\n' ? end - 1 : end;
    const lineEnd = value.indexOf('\n', last);
    const blockEnd = lineEnd === -1 ? value.length : lineEnd;
    const lines = value.slice(blockStart, blockEnd).split('\n');
    area.setRangeText(lines.map((l) => '  ' + l).join('\n'), blockStart, blockEnd);
    area.setSelectionRange(start + 2, end + 2 * lines.length);
  }

  override render() {
    const p = this.pending;
    if (!p) return html`<dialog></dialog>`;
    return html`<dialog @cancel=${(e: Event) => (e.preventDefault(), this.finish(null))}>
      <form @submit=${this.submit}>
        <h2>${t('snippet.editTitle')}</h2>
        <label for="name">${t('snippet.nameLabel')}</label>
        <input id="name" class="input" .value=${p.snippet.name} spellcheck="false" />
        <label for="body">${t('snippet.bodyLabel')}</label>
        <textarea id="body" .value=${p.snippet.body} spellcheck="false" @keydown=${this.onKey}></textarea>
        ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
        <div class="actions">
          <button type="button" class="btn" @click=${() => this.finish(null)}>${t('common.cancel')}</button>
          <button type="submit" class="btn primary">${t('common.save')}</button>
        </div>
      </form>
    </dialog>`;
  }
}

customElements.define('editha-snippet-editor', EdithaSnippetEditor);
