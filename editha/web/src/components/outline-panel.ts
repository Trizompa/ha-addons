import { LitElement, css, html, nothing } from 'lit';
import type { Outline, OutlineItem } from '../editor/outline.js';
import { t } from '../i18n/index.js';
import { icon, icons } from '../ui/icons.js';
import { sharedStyles } from '../ui/shared-styles.js';
import { clearable } from '../ui/clearable.js';

/**
 * ED-18: schema del file aperto, a fianco dell'editor. Un clic porta alla voce;
 * la voce in cui si trova il cursore è evidenziata.
 */
export class EdithaOutlinePanel extends LitElement {
  static override properties = {
    items: { attribute: false },
    active: { type: Number },
    file: { type: String },
    filter: { state: true },
  };

  /** null: nessun file YAML aperto. */
  declare items: OutlineItem[] | null;
  declare active: number;
  /** File a cui si riferisce lo schema. */
  declare file: string | null;
  declare filter: string;

  constructor() {
    super();
    this.items = null;
    this.active = -1;
    this.file = null;
    this.filter = '';
  }

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        width: 260px;
        min-width: 0;
        background: var(--surface);
        border-left: 1px solid var(--border);
      }
      header {
        display: flex;
        align-items: center;
        gap: 4px;
        height: 40px;
        padding: 0 6px 0 12px;
        flex: none;
      }
      header h2 {
        flex: 1;
        margin: 0;
        font-size: 13px;
        font-weight: 600;
      }
      .filter {
        padding: 0 8px 8px;
        flex: none;
      }
      .filter input {
        width: 100%;
      }
      .list {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 0 6px 8px;
      }
      button.item {
        display: flex;
        align-items: baseline;
        gap: 6px;
        width: 100%;
        min-height: 28px;
        padding: 4px 8px;
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--text);
        font: inherit;
        font-size: 13px;
        text-align: left;
        cursor: pointer;
      }
      button.item:hover {
        background: var(--hover);
      }
      button.item[aria-current='true'] {
        background: var(--accent-soft);
        color: var(--accent);
        font-weight: 500;
      }
      button.item.child {
        padding-left: 24px;
      }
      .label {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .detail {
        flex: none;
        max-width: 40%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 11px;
        color: var(--text-muted);
      }
      .line {
        flex: none;
        font-size: 11px;
        color: var(--text-faint);
        font-variant-numeric: tabular-nums;
      }
      .note {
        padding: 12px;
        font-size: 13px;
        line-height: 1.5;
        color: var(--text-muted);
      }
    `,
  ];

  /** Il filtro vale per il file su cui è stato scritto: cambiando file si riparte da zero. */
  override willUpdate(changed: Map<string, unknown>): void {
    if (this.hasUpdated && changed.has('file')) this.filter = '';
  }

  override updated(changed: Map<string, unknown>): void {
    // La voce attiva resta visibile mentre ci si sposta nel file.
    if (changed.has('active') && !this.filter) {
      this.renderRoot.querySelector('button.item[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
    }
  }

  private emit(name: string, detail: unknown = {}): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private renderList() {
    const items = this.items;
    if (items === null) return html`<div class="note">${t('outline.noYaml')}</div>`;
    if ((items as Outline).tooLarge) return html`<div class="note">${t('outline.tooLarge')}</div>`;
    if (items.length === 0) return html`<div class="note">${t('outline.empty')}</div>`;
    const q = this.filter.trim().toLowerCase();
    const shown = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !q || `${item.label} ${item.detail ?? ''}`.toLowerCase().includes(q));
    if (shown.length === 0) return html`<div class="note">${t('outline.noMatch')}</div>`;
    return html`<div class="list" role="list">
      ${shown.map(
        ({ item, index }) => html`<button
          class="item ${item.depth && !q ? 'child' : ''}"
          role="listitem"
          aria-current=${index === this.active}
          data-line=${item.line}
          title=${`${item.label}${item.detail ? ` (${item.detail})` : ''} · ${t('status.lineN', { n: item.line })}`}
          @click=${() => this.emit('outline-go', { line: item.line })}
        >
          <span class="label">${item.label}</span>
          ${item.detail ? html`<span class="detail">${item.detail}</span>` : nothing}
          <span class="line">${item.line}</span>
        </button>`,
      )}
    </div>`;
  }

  override render() {
    return html`
      <header>
        <h2>${t('outline.title')}</h2>
        <button class="icon-btn small" title=${t('common.close')} @click=${() => this.emit('outline-close')}>
          ${icon(icons.close, 16)}
        </button>
      </header>
      ${(this.items && this.items.length > 8) || this.filter
        ? html`<div class="filter">
            ${clearable(
              html`<input
                class="input"
                placeholder=${t('outline.filter')}
                spellcheck="false"
                .value=${this.filter}
                @input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)}
              />`,
              this.filter,
              () => (this.filter = ''),
            )}
          </div>`
        : nothing}
      ${this.renderList()}
    `;
  }
}

customElements.define('editha-outline-panel', EdithaOutlinePanel);
