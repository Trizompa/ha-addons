import { LitElement, css, html, nothing } from 'lit';
import type { EntityInfo, Snippet } from '../api/types.js';
import { builtinSnippets } from '../editor/snippets.js';
import { t } from '../i18n/index.js';
import { haData } from '../state/ha-data.js';
import { icon, icons } from '../ui/icons.js';
import { sharedStyles } from '../ui/shared-styles.js';

export type InsertTab = 'entities' | 'snippets';

const MAX_ROWS = 300;

/**
 * Pannello laterale "Inserisci": entità del proprio HA e snippet (predefiniti e
 * personali). Un clic inserisce nel punto del cursore della tab attiva.
 */
export class EdithaInsertPanel extends LitElement {
  static override properties = {
    tab: { type: String, reflect: true },
    userSnippets: { attribute: false },
    canInsert: { type: Boolean },
    query: { state: true },
    tick: { state: true },
  };

  declare tab: InsertTab;
  declare userSnippets: Snippet[];
  declare canInsert: boolean;
  declare query: string;
  declare tick: number;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super();
    this.tab = 'entities';
    this.userSnippets = [];
    this.canInsert = false;
    this.query = '';
    this.tick = 0;
  }

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        width: 360px;
        max-width: 100%;
        height: 100%;
        background: var(--surface);
        border-left: 1px solid var(--border);
        box-shadow: var(--shadow-pop);
      }
      header {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 8px 8px 0 12px;
      }
      .tabs {
        display: flex;
        flex: 1;
        gap: 4px;
        padding: 3px;
        border-radius: var(--radius);
        background: var(--surface-3);
      }
      .tabs button {
        flex: 1;
        height: 30px;
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--text-muted);
        font-weight: 500;
        cursor: pointer;
      }
      .tabs button[aria-selected='true'] {
        background: var(--surface);
        color: var(--text);
        box-shadow: var(--shadow);
      }
      .search {
        position: relative;
        padding: 10px 12px 8px;
      }
      .search svg {
        position: absolute;
        left: 22px;
        top: 19px;
        color: var(--text-faint);
        pointer-events: none;
      }
      .search .input {
        height: 34px;
        padding-left: 32px;
        font-size: 13px;
      }
      .hint {
        padding: 0 14px 8px;
        font-size: 12px;
        color: var(--text-faint);
      }
      .list {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 0 8px 12px;
      }
      .section {
        padding: 10px 6px 4px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--text-muted);
      }
      .item {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 7px 8px;
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        text-align: left;
        cursor: pointer;
      }
      .item:hover:not(:disabled),
      .item:focus-visible {
        background: var(--accent-soft);
        outline: none;
      }
      .item:disabled {
        cursor: default;
        opacity: 0.6;
      }
      .main {
        flex: 1;
        min-width: 0;
      }
      .title {
        font-size: 13px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sub {
        font-family: var(--font-code);
        font-size: 11.5px;
        color: var(--text-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .desc {
        font-size: 12px;
        color: var(--text-muted);
      }
      .state {
        flex: none;
        max-width: 110px;
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--surface-3);
        color: var(--text-muted);
        font-size: 11.5px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .row {
        display: flex;
        align-items: center;
      }
      .row .item {
        flex: 1;
        min-width: 0;
      }
      .empty {
        padding: 16px 10px;
        font-size: 13px;
        color: var(--text-muted);
        line-height: 1.5;
      }
      footer {
        padding: 10px 12px;
        border-top: 1px solid var(--border);
      }
      footer .btn {
        width: 100%;
        justify-content: center;
      }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = haData.subscribe(() => this.tick++);
  }

  override disconnectedCallback(): void {
    this.unsubscribe?.();
    super.disconnectedCallback();
  }

  focusSearch(): void {
    void this.updateComplete.then(() => (this.renderRoot.querySelector('.search input') as HTMLInputElement)?.focus());
  }

  private emit(name: string, detail: unknown = {}): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private filterEntities(): EntityInfo[] {
    const q = this.query.trim().toLowerCase();
    if (!q) return haData.entities;
    const words = q.split(/\s+/);
    return haData.entities.filter((e) => {
      const hay = `${e.entity_id} ${e.name}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }

  private renderEntities() {
    if (!haData.loaded) return html`<div class="empty">${t('insert.loading')}</div>`;
    if (!haData.available) {
      return html`<div class="empty">${t('insert.haUnavailable')}</div>`;
    }
    const list = this.filterEntities();
    if (list.length === 0) return html`<div class="empty">${t('insert.noEntities')}</div>`;
    return html`${list.slice(0, MAX_ROWS).map(
        (e) => html`<div class="row"><button
          class="item"
          ?disabled=${!this.canInsert}
          title=${this.canInsert ? t('insert.insertEntity', { id: e.entity_id }) : t('insert.openFirst')}
          @click=${() => this.emit('insert-text', { text: e.entity_id })}
        >
          <span class="main">
            <div class="title">${e.name || e.entity_id}</div>
            <div class="sub">${e.entity_id}</div>
          </span>
          <span class="state" title=${e.state}>${e.state}${e.unit ? ` ${e.unit}` : ''}</span>
        </button>
        <button
          class="icon-btn small usages"
          title=${t('search.usages', { id: e.entity_id })}
          @click=${() => this.emit('entity-usages', { id: e.entity_id })}
        >
          ${icon(icons.searchAll, 16)}
        </button></div>`,
      )}
      ${list.length > MAX_ROWS
        ? html`<div class="empty">${t('insert.moreEntities', { n: list.length - MAX_ROWS })}</div>`
        : nothing}`;
  }

  private renderSnippets() {
    const q = this.query.trim().toLowerCase();
    const match = (name: string, extra: string) => !q || `${name} ${extra}`.toLowerCase().includes(q);
    const builtins = builtinSnippets().filter((s) => match(s.name, s.description));
    const mine = this.userSnippets.filter((s) => match(s.name, s.body));
    return html`
      <div class="section">${t('insert.mySnippets')}</div>
      ${mine.length === 0
        ? html`<div class="empty">
            ${q ? t('insert.noMatchingSnippets') : t('insert.noMySnippets')}
          </div>`
        : mine.map(
            (s) => html`<div class="row">
              <button
                class="item"
                ?disabled=${!this.canInsert}
                @click=${() => this.emit('insert-snippet', { body: s.body, fields: false })}
              >
                <span class="main">
                  <div class="title">${s.name}</div>
                  <div class="sub">${s.body.split('\n')[0]}</div>
                </span>
              </button>
              <button
                class="icon-btn small"
                title=${t('insert.editSnippet')}
                @click=${() => this.emit('snippet-edit', { id: s.id })}
              >
                ${icon(icons.rename, 16)}
              </button>
              <button
                class="icon-btn small"
                title=${t('insert.deleteSnippet')}
                @click=${() => this.emit('snippet-delete', { id: s.id, name: s.name })}
              >
                ${icon(icons.delete, 16)}
              </button>
            </div>`,
          )}
      <div class="section">${t('insert.builtin')}</div>
      ${builtins.map(
        (s) => html`<button
          class="item"
          ?disabled=${!this.canInsert}
          title=${t('insert.tabHint')}
          @click=${() => this.emit('insert-snippet', { body: s.body, fields: true })}
        >
          <span class="main">
            <div class="title">${s.name}</div>
            <div class="desc">${s.description}</div>
          </span>
        </button>`,
      )}
    `;
  }

  override render() {
    const entities = this.tab === 'entities';
    return html`
      <header>
        <div class="tabs" role="tablist">
          <button role="tab" aria-selected=${entities} @click=${() => (this.tab = 'entities')}>${t('insert.tabEntities')}</button>
          <button role="tab" aria-selected=${!entities} @click=${() => (this.tab = 'snippets')}>${t('insert.tabSnippets')}</button>
        </div>
        ${entities
          ? html`<button class="icon-btn small" title=${t('insert.refreshEntities')} @click=${() => void haData.refresh(true)}>
              ${icon(icons.refresh, 17)}
            </button>`
          : nothing}
        <button class="icon-btn small" title=${t('common.close')} @click=${() => this.emit('panel-close')}>
          ${icon(icons.close, 17)}
        </button>
      </header>
      <div class="search">
        ${icon(icons.search, 16)}
        <input
          class="input"
          spellcheck="false"
          placeholder=${entities ? t('insert.searchEntities') : t('insert.searchSnippets')}
          .value=${this.query}
          @input=${(e: Event) => (this.query = (e.target as HTMLInputElement).value)}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Escape') this.emit('panel-close');
          }}
        />
      </div>
      ${!this.canInsert ? html`<div class="hint">${t('insert.openFileHint')}</div>` : nothing}
      <div class="list">${entities ? this.renderEntities() : this.renderSnippets()}</div>
      ${entities
        ? nothing
        : html`<footer>
            <button class="btn" ?disabled=${!this.canInsert} @click=${() => this.emit('snippet-save')}>
              ${icon(icons.save, 16)} ${t('insert.saveSelection')}
            </button>
          </footer>`}
    `;
  }
}

customElements.define('editha-insert-panel', EdithaInsertPanel);
