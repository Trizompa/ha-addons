import { LitElement, css, html, nothing } from 'lit';
import { t } from '../i18n/index.js';
import { icon, icons } from '../ui/icons.js';
import { sharedStyles } from '../ui/shared-styles.js';

interface Pending {
  title: string;
  folders: string[];
  /** Cartelle non selezionabili (quella attuale, la cartella stessa e le sue sottocartelle). */
  disabled: (folder: string) => boolean;
  resolve: (folder: string | null) => void;
}

/** FS-5: finestra per scegliere la cartella di destinazione di "Sposta in…". */
export class EdithaFolderPicker extends LitElement {
  static override properties = {
    pending: { state: true },
    filter: { state: true },
    chosen: { state: true },
  };

  declare pending: Pending | null;
  declare filter: string;
  declare chosen: string | null;

  constructor() {
    super();
    this.pending = null;
    this.filter = '';
    this.chosen = null;
  }

  static override styles = [
    sharedStyles,
    css`
      dialog {
        width: min(480px, calc(100vw - 32px));
        max-height: min(560px, calc(100vh - 48px));
        padding: 0;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        background: var(--surface);
        color: var(--text);
        box-shadow: var(--shadow-pop);
      }
      dialog[open] {
        display: flex;
        flex-direction: column;
      }
      dialog::backdrop {
        background: var(--scrim);
        backdrop-filter: blur(2px);
      }
      h2 {
        margin: 0;
        padding: 18px 20px 10px;
        font-size: 16px;
        overflow-wrap: anywhere;
      }
      .search {
        padding: 0 20px 10px;
      }
      .list {
        flex: 1;
        min-height: 120px;
        overflow: auto;
        margin: 0 12px;
        padding: 4px;
        border: 1px solid var(--border);
        border-radius: var(--radius);
      }
      .folder {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 6px 8px;
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--text);
        font: inherit;
        font-size: 13px;
        text-align: left;
        cursor: pointer;
      }
      .folder:hover:not(:disabled) {
        background: var(--hover);
      }
      .folder[aria-selected='true'] {
        background: var(--accent-soft);
      }
      .folder:disabled {
        cursor: default;
        opacity: 0.45;
      }
      .folder svg {
        flex: none;
        color: #e8a33d;
      }
      .folder span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .empty {
        padding: 14px;
        color: var(--text-muted);
        font-size: 13px;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 14px 20px 18px;
      }
    `,
  ];

  /** Apre la finestra; restituisce la cartella scelta ('' = /config) o null se annullato. */
  pick(opts: Omit<Pending, 'resolve'>): Promise<string | null> {
    this.pending?.resolve(null);
    return new Promise((resolve) => {
      this.filter = '';
      this.chosen = null;
      this.pending = { ...opts, resolve };
      void this.updateComplete.then(() => {
        const dialog = this.renderRoot.querySelector('dialog')!;
        if (!dialog.open) dialog.showModal();
        (this.renderRoot.querySelector('input') as HTMLInputElement | null)?.focus();
      });
    });
  }

  private finish(folder: string | null): void {
    const pending = this.pending;
    this.pending = null;
    (this.renderRoot.querySelector('dialog') as HTMLDialogElement | null)?.close();
    pending?.resolve(folder);
  }

  override render() {
    const p = this.pending;
    if (!p) return html`<dialog></dialog>`;
    const q = this.filter.trim().toLowerCase();
    const list = ['', ...p.folders].filter((f) => !q || `/config/${f}`.toLowerCase().includes(q));
    // La cartella scelta deve restare visibile: se il filtro la nasconde, la scelta si annulla.
    if (this.chosen !== null && !list.includes(this.chosen)) queueMicrotask(() => (this.chosen = null));
    return html`<dialog @cancel=${(e: Event) => (e.preventDefault(), this.finish(null))}>
      <h2>${p.title}</h2>
      <div class="search">
        <input
          class="input"
          spellcheck="false"
          placeholder=${t('move.filter')}
          .value=${this.filter}
          @input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)}
        />
      </div>
      <div class="list" role="listbox">
        ${list.length === 0 ? html`<div class="empty">${t('move.noMatch')}</div>` : nothing}
        ${list.map(
          (f) => html`<button
            class="folder"
            role="option"
            data-folder=${f}
            aria-selected=${this.chosen === f}
            ?disabled=${p.disabled(f)}
            @click=${() => (this.chosen = f)}
            @dblclick=${() => !p.disabled(f) && this.finish(f)}
          >
            ${icon(icons.folder, 16)}<span>/config${f ? '/' + f : ''}</span>
          </button>`,
        )}
      </div>
      <div class="actions">
        <button class="btn" @click=${() => this.finish(null)}>${t('common.cancel')}</button>
        <button class="btn primary" ?disabled=${this.chosen === null} @click=${() => this.finish(this.chosen)}>
          ${t('move.confirm')}
        </button>
      </div>
    </dialog>`;
  }
}

customElements.define('editha-folder-picker', EdithaFolderPicker);
