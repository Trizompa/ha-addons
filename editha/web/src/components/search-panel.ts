import { LitElement, css, html, nothing } from 'lit';
import { api, ApiError } from '../api/client.js';
import type { SearchMatch, SearchResult } from '../api/types.js';
import { t } from '../i18n/index.js';
import { haData } from '../state/ha-data.js';
import { icon, icons } from '../ui/icons.js';
import { sharedStyles } from '../ui/shared-styles.js';

export interface SearchRequest {
  query: string;
  regex?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

/** entity_id di HA: dominio.oggetto. */
export const ENTITY_ID = /^[a-z_][a-z0-9_]*\.[a-z0-9_]+$/;

/**
 * SR-1/SR-2: ricerca in tutti i file di /config, nella barra laterale al posto dell'albero.
 * SR-4: con un entity_id e "parola intera" mostra dove è usata un'entità.
 */
export class EdithaSearchPanel extends LitElement {
  static override properties = {
    query: { state: true },
    regex: { state: true },
    caseSensitive: { state: true },
    wholeWord: { state: true },
    result: { state: true },
    error: { state: true },
    busy: { state: true },
    collapsed: { state: true },
    replaceOpen: { state: true },
    replacement: { state: true },
  };

  declare query: string;
  declare regex: boolean;
  declare caseSensitive: boolean;
  declare wholeWord: boolean;
  declare result: SearchResult | null;
  declare error: string | null;
  declare busy: boolean;
  declare collapsed: Set<string>;
  /** SR-3: riga "Sostituisci con" aperta. */
  declare replaceOpen: boolean;
  declare replacement: string;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private token = 0;
  private searched: SearchRequest | null = null;

  constructor() {
    super();
    this.query = '';
    this.replaceOpen = false;
    this.replacement = '';
    this.regex = false;
    this.caseSensitive = false;
    this.wholeWord = false;
    this.result = null;
    this.error = null;
    this.busy = false;
    this.collapsed = new Set();
  }

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }
      :host([hidden]) {
        display: none;
      }
      header {
        display: flex;
        align-items: center;
        gap: 2px;
        height: 40px;
        padding: 0 6px 0 14px;
        flex: none;
      }
      header h2 {
        flex: 1;
        margin: 0;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-muted);
      }
      .box {
        position: relative;
        margin: 0 10px 6px;
      }
      .box .input {
        height: 32px;
        padding-right: 92px;
        font-size: 13px;
      }
      .toggles {
        position: absolute;
        top: 3px;
        right: 4px;
        display: flex;
        gap: 2px;
      }
      .toggle {
        width: 26px;
        height: 26px;
        border: 1px solid transparent;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--text-muted);
        font: 600 11px var(--font-code);
        cursor: pointer;
      }
      .toggle:hover {
        background: var(--hover);
      }
      .toggle[aria-pressed='true'] {
        border-color: var(--accent);
        background: var(--accent-soft);
        color: var(--text);
      }
      .summary,
      .entity,
      .note {
        margin: 0 14px 6px;
        font-size: 12px;
        color: var(--text-muted);
      }
      .entity {
        padding: 6px 8px;
        border-radius: var(--radius-sm);
        background: var(--surface-3);
        color: var(--text);
      }
      .entity code {
        font-family: var(--font-code);
      }
      .error {
        margin: 0 14px 6px;
        font-size: 12px;
        color: var(--danger);
      }
      .replace {
        display: flex;
        gap: 6px;
        margin: 0 10px 8px;
      }
      .replace .btn {
        height: 32px;
        padding: 0 10px;
        font-size: 12.5px;
        white-space: nowrap;
      }
      .replace .input {
        flex: 1;
        min-width: 0;
        height: 32px;
        font-size: 13px;
      }
      .filerow {
        display: flex;
        align-items: center;
      }
      .filerow .file {
        flex: 1;
        min-width: 0;
      }
      .list {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 0 6px 16px;
      }
      .file {
        display: flex;
        align-items: center;
        gap: 4px;
        width: 100%;
        height: 26px;
        padding: 0 6px;
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--text);
        font: inherit;
        font-size: 13px;
        text-align: left;
        cursor: pointer;
      }
      .file:hover,
      .match:hover {
        background: var(--hover);
      }
      .file .name {
        font-weight: 500;
        white-space: nowrap;
      }
      .file .dir {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--text-faint);
        font-size: 12px;
      }
      .count {
        flex: none;
        min-width: 18px;
        padding: 0 6px;
        border-radius: 999px;
        background: var(--surface-3);
        color: var(--text-muted);
        font-size: 11px;
        text-align: center;
      }
      .match {
        display: flex;
        gap: 8px;
        width: 100%;
        padding: 3px 6px 3px 26px;
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--text);
        font: 12px var(--font-code);
        text-align: left;
        cursor: pointer;
      }
      .match .ln {
        flex: none;
        min-width: 26px;
        color: var(--text-faint);
        text-align: right;
      }
      .match .text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: pre;
      }
      mark {
        border-radius: 2px;
        background: var(--editor-selection-match, rgba(255, 200, 0, 0.35));
        color: inherit;
      }
    `,
  ];

  /** Avvia una ricerca dall'esterno (es. "dove è usata" un'entità). */
  searchFor(req: SearchRequest): void {
    this.query = req.query;
    this.regex = !!req.regex;
    this.caseSensitive = !!req.caseSensitive;
    this.wholeWord = !!req.wholeWord;
    void this.run();
    this.focusInput();
  }

  focusInput(): void {
    void this.updateComplete.then(() => {
      const input = this.renderRoot.querySelector('input') as HTMLInputElement | null;
      input?.focus();
      input?.select();
    });
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), 400);
  }

  /** Rifà la ricerca (dopo una sostituzione i risultati cambiano). */
  rerun(): Promise<void> {
    return this.run();
  }

  /** Chiede all'app di sostituire nei file indicati, con la stessa ricerca che li ha trovati. */
  private requestReplace(paths: string[]): void {
    const req = this.searched;
    const result = this.result;
    if (!req || !result || paths.length === 0) return;
    const matches = result.results.filter((r) => paths.includes(r.path)).reduce((n, r) => n + r.matches.length, 0);
    this.emit('search-replace', { paths, request: req, replacement: this.replacement, matches });
  }

  private async run(): Promise<void> {
    clearTimeout(this.timer);
    const query = this.query;
    if (query.trim().length < 2 && !this.regex) {
      // Una ricerca ancora in viaggio non deve far ricomparire i risultati vecchi.
      ++this.token;
      this.busy = false;
      this.result = null;
      this.error = null;
      return;
    }
    const req: SearchRequest = {
      query,
      regex: this.regex,
      caseSensitive: this.caseSensitive,
      wholeWord: this.wholeWord,
    };
    const token = ++this.token;
    this.busy = true;
    try {
      const result = await api.search(req);
      if (token !== this.token) return;
      this.result = result;
      this.searched = req;
      this.error = null;
      this.collapsed = new Set();
    } catch (err) {
      if (token !== this.token) return;
      this.result = null;
      this.error = err instanceof ApiError ? err.message : String(err);
    } finally {
      if (token === this.token) this.busy = false;
    }
  }

  private toggle(name: 'regex' | 'caseSensitive' | 'wholeWord'): void {
    this[name] = !this[name];
    void this.run();
  }

  private emit(name: string, detail: unknown = {}): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private renderLine(m: SearchMatch) {
    // Il server manda la parte della riga attorno alla corrispondenza, che inizia a `offset`.
    const start = Math.min(Math.max(0, m.column - 1 - (m.offset ?? 0)), m.text.length);
    const end = Math.min(start + m.length, m.text.length);
    // Si parte poco prima della corrispondenza, così resta visibile anche nelle righe lunghe.
    const from = Math.max(0, start - 30);
    const lead = m.text.slice(from, start).replace(/^\s+/, '');
    return html`${from > 0 || (m.offset ?? 0) > 0 ? '…' : ''}${lead}<mark>${m.text.slice(start, end)}</mark>${m.text.slice(end)}`;
  }

  private renderEntity() {
    const q = this.searched?.query ?? '';
    if (!this.searched?.wholeWord || !ENTITY_ID.test(q)) return nothing;
    const entity = haData.entities.find((e) => e.entity_id === q);
    if (!entity) return nothing;
    return html`<div class="entity">
      ${t('search.entity')} <code>${entity.entity_id}</code>${entity.name ? ` · ${entity.name}` : ''} ·
      ${entity.state}${entity.unit ? ` ${entity.unit}` : ''}
    </div>`;
  }

  private renderResults() {
    const r = this.result;
    if (!r) return nothing;
    const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
    const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
    return html`
      <div class="summary">
        ${r.matches === 0
          ? t('search.none')
          : r.matches === 1
            ? t('search.single')
            : t(r.results.length === 1 ? 'search.summaryOne' : 'search.summary', { n: r.matches, files: r.results.length })}
        ${r.truncated ? html` · ${t('search.truncated')}` : nothing}
      </div>
      ${this.renderEntity()}
      <div class="list">
        ${r.results.map((file) => {
          const closed = this.collapsed.has(file.path);
          return html`<div class="filerow"><button
              class="file"
              title=${'/config/' + file.path}
              @click=${() => {
                const next = new Set(this.collapsed);
                if (closed) next.delete(file.path);
                else next.add(file.path);
                this.collapsed = next;
              }}
            >
              ${icon(closed ? icons.chevronRight : icons.chevronDown, 16)}
              <span class="name">${nameOf(file.path)}</span>
              <span class="dir">${dirOf(file.path)}</span>
              <span class="count">${file.matches.length}</span>
            </button>${this.replaceOpen
              ? html`<button
                  class="icon-btn small"
                  data-replace=${file.path}
                  title=${t('replace.inFile', { name: nameOf(file.path) })}
                  @click=${() => this.requestReplace([file.path])}
                >
                  ${icon(icons.replace, 15)}
                </button>`
              : nothing}</div>
            ${closed
              ? nothing
              : file.matches.map(
                  (m) => html`<button
                    class="match"
                    data-path=${file.path}
                    data-line=${m.line}
                    @click=${() => this.emit('search-open', { path: file.path, match: m })}
                  >
                    <span class="ln">${m.line}</span><span class="text">${this.renderLine(m)}</span>
                  </button>`,
                )}`;
        })}
      </div>
    `;
  }

  override render() {
    return html`
      <header>
        <h2>${t('search.title')}</h2>
        ${this.busy ? html`<span class="note">${t('search.busy')}</span>` : nothing}
        <button
          class="icon-btn small ${this.replaceOpen ? 'on' : ''}"
          title=${t('replace.toggle')}
          aria-pressed=${this.replaceOpen}
          @click=${() => (this.replaceOpen = !this.replaceOpen)}
        >
          ${icon(icons.replace, 17)}
        </button>
        <button class="icon-btn small" title=${t('search.backToFiles')} @click=${() => this.emit('search-close')}>
          ${icon(icons.close, 17)}
        </button>
      </header>
      <div class="box">
        <input
          class="input"
          spellcheck="false"
          placeholder=${t('search.placeholder')}
          .value=${this.query}
          @input=${(e: Event) => {
            this.query = (e.target as HTMLInputElement).value;
            this.schedule();
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter') void this.run();
            if (e.key === 'Escape') this.emit('search-close');
          }}
        />
        <div class="toggles">
          <button class="toggle" title=${t('search.caseSensitive')} aria-pressed=${this.caseSensitive} @click=${() => this.toggle('caseSensitive')}>Aa</button>
          <button class="toggle" title=${t('search.wholeWord')} aria-pressed=${this.wholeWord} @click=${() => this.toggle('wholeWord')}>ab</button>
          <button class="toggle" title=${t('search.regex')} aria-pressed=${this.regex} @click=${() => this.toggle('regex')}>.*</button>
        </div>
      </div>
      ${this.replaceOpen
        ? html`<div class="replace">
            <input
              class="input"
              spellcheck="false"
              placeholder=${t('replace.placeholder')}
              .value=${this.replacement}
              @input=${(e: Event) => (this.replacement = (e.target as HTMLInputElement).value)}
            />
            <button
              class="btn small primary"
              data-action="replace-all"
              ?disabled=${!this.result || this.result.matches === 0 || this.busy}
              @click=${() => this.requestReplace(this.result?.results.map((r) => r.path) ?? [])}
            >
              ${t('replace.all')}
            </button>
          </div>`
        : nothing}
      ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
      ${!this.result && !this.error ? html`<div class="note">${t('search.hint')}</div>` : nothing}
      ${this.renderResults()}
    `;
  }
}

customElements.define('editha-search-panel', EdithaSearchPanel);
