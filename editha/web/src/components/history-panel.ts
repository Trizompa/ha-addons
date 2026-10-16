import { LitElement, css, html, nothing } from 'lit';
import { EditorView } from '@codemirror/view';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import { api } from '../api/client.js';
import type { Version } from '../api/types.js';
import { viewerExtensions, type EditorPrefs } from '../editor/setup.js';
import { getLang, t, type MessageKey } from '../i18n/index.js';
import { basename } from '../state/paths.js';
import { icon, icons } from '../ui/icons.js';
import { sharedStyles } from '../ui/shared-styles.js';

const NARROW = '(max-width: 760px)';

/** Data e ora di una versione nella lingua dell'interfaccia. */
export function formatVersionDate(iso: string): string {
  return new Intl.DateTimeFormat(getLang(), { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(iso));
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * BK-2/3/4: versioni conservate di un file, confronto con il contenuto attuale
 * (affiancato su schermi larghi, unificato su telefono) e ripristino.
 */
export class EdithaHistoryPanel extends LitElement {
  static override properties = {
    path: { type: String },
    current: { type: String },
    prefs: { attribute: false },
    canRestore: { type: Boolean },
    versions: { state: true },
    selectedId: { state: true },
    loading: { state: true },
    error: { state: true },
    same: { state: true },
  };

  declare path: string;
  /** Contenuto attuale: quello della tab aperta (anche non salvato) o quello su disco. */
  declare current: string;
  declare prefs: EditorPrefs;
  declare canRestore: boolean;
  declare versions: Version[] | null;
  declare selectedId: string | null;
  declare loading: boolean;
  declare error: string | null;
  declare same: boolean;

  private merge: MergeView | EditorView | null = null;
  private loadToken = 0;
  private listToken = 0;
  private readonly narrowQuery = window.matchMedia(NARROW);

  constructor() {
    super();
    this.path = '';
    this.current = '';
    this.prefs = { wordWrap: false, fontSize: 14 };
    this.canRestore = true;
    this.versions = null;
    this.selectedId = null;
    this.loading = false;
    this.error = null;
    this.same = false;
  }

  static override styles = [
    sharedStyles,
    css`
      :host {
        position: absolute;
        inset: 0;
        z-index: 20;
        display: flex;
        flex-direction: column;
        background: var(--bg);
      }
      header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px 8px 14px;
        border-bottom: 1px solid var(--border);
        background: var(--surface);
      }
      header h2 {
        flex: 1;
        min-width: 0;
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      header h2 small {
        margin-left: 8px;
        font-weight: 400;
        color: var(--text-muted);
      }
      .content {
        flex: 1;
        min-height: 0;
        display: grid;
        grid-template-columns: 250px 1fr;
      }
      .list {
        min-height: 0;
        overflow: auto;
        padding: 8px;
        border-right: 1px solid var(--border);
        background: var(--surface);
      }
      .version {
        display: block;
        width: 100%;
        margin-bottom: 2px;
        padding: 7px 10px;
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        text-align: left;
        cursor: pointer;
      }
      .version:hover {
        background: var(--hover);
      }
      .version[aria-selected='true'] {
        background: var(--accent-soft);
      }
      .version .date {
        font-size: 13px;
        font-weight: 500;
      }
      .version .sub {
        font-size: 12px;
        color: var(--text-muted);
      }
      .compare {
        min-width: 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      .labels {
        display: grid;
        grid-template-columns: 1fr 1fr;
        font-size: 12px;
        color: var(--text-muted);
        border-bottom: 1px solid var(--border);
        background: var(--surface-2, var(--surface));
      }
      .labels span {
        padding: 6px 12px;
      }
      .labels .old {
        color: var(--danger, #d33);
      }
      .labels .new {
        color: var(--success, #2a2);
      }
      .merge {
        position: relative;
        flex: 1;
        min-height: 0;
        background: var(--editor-bg);
      }
      .merge > * {
        position: absolute;
        inset: 0;
      }
      .merge .cm-mergeView,
      .merge > .cm-editor {
        height: 100%;
        overflow: auto;
      }
      .merge .cm-mergeView,
      .merge .cm-scroller {
        overscroll-behavior: none;
      }
      .merge .cm-editor.cm-focused {
        outline: none;
      }
      .note,
      .empty {
        padding: 16px;
        font-size: 13px;
        color: var(--text-muted);
        line-height: 1.5;
      }
      footer {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-top: 1px solid var(--border);
        background: var(--surface);
      }
      footer .hint {
        flex: 1;
        font-size: 12px;
        color: var(--text-muted);
      }
      @media (max-width: 760px) {
        .content {
          grid-template-columns: 1fr;
          grid-template-rows: auto 1fr;
        }
        .list {
          display: flex;
          gap: 4px;
          max-height: none;
          overflow-x: auto;
          overflow-y: hidden;
          border-right: none;
          border-bottom: 1px solid var(--border);
        }
        .version {
          flex: none;
          width: auto;
          margin: 0;
        }
        .labels {
          grid-template-columns: 1fr;
        }
      }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    this.narrowQuery.addEventListener('change', this.onNarrowChange);
    void this.loadVersions();
  }

  override disconnectedCallback(): void {
    this.narrowQuery.removeEventListener('change', this.onNarrowChange);
    this.destroyMerge();
    super.disconnectedCallback();
  }

  private readonly onNarrowChange = () => void this.showVersion(this.selectedId);

  /** Con il pannello già aperto su un altro file si ricarica l'elenco di quel file. */
  override willUpdate(changed: Map<string, unknown>): void {
    if (this.hasUpdated && changed.has('path')) {
      this.destroyMerge();
      this.versions = null;
      this.selectedId = null;
      this.error = null;
      void this.loadVersions();
    }
  }

  /** Ricarica l'elenco (dopo un ripristino) mantenendo il pannello aperto. */
  async reload(current: string): Promise<void> {
    this.current = current;
    await this.loadVersions();
  }

  private async loadVersions(): Promise<void> {
    // Una risposta arrivata tardi per un file precedente non deve sostituire quella attuale.
    const token = ++this.listToken;
    const path = this.path;
    let versions: Version[];
    let error: string | null = null;
    try {
      versions = (await api.versions(path)).versions.filter((v) => v.kind === 'file');
    } catch (err) {
      versions = [];
      error = err instanceof Error ? err.message : String(err);
    }
    if (token !== this.listToken) return;
    this.versions = versions;
    this.error = error;
    await this.showVersion(this.versions[0]?.id ?? null);
  }

  private emit(name: string, detail: unknown = {}): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private destroyMerge(): void {
    this.merge?.destroy();
    this.merge = null;
  }

  private async showVersion(id: string | null): Promise<void> {
    this.selectedId = id;
    const token = ++this.loadToken;
    this.destroyMerge();
    if (!id) return;
    this.loading = true;
    let content: string;
    try {
      content = (await api.version(this.path, id)).content;
    } catch (err) {
      if (token !== this.loadToken) return;
      this.loading = false;
      this.error = err instanceof Error ? err.message : String(err);
      return;
    }
    if (token !== this.loadToken) return;
    this.loading = false;
    this.error = null;
    this.same = content === this.current;
    await this.updateComplete;
    const parent = this.renderRoot.querySelector('.merge') as HTMLElement | null;
    if (!parent || token !== this.loadToken) return;
    const extensions = viewerExtensions(this.path, this.prefs);
    const collapse = { margin: 3, minSize: 6 };
    if (this.narrowQuery.matches) {
      this.merge = new EditorView({
        doc: this.current,
        extensions: [
          extensions,
          unifiedMergeView({ original: content, mergeControls: false, collapseUnchanged: collapse }),
        ],
        parent,
        root: this.renderRoot as ShadowRoot,
      });
    } else {
      this.merge = new MergeView({
        a: { doc: content, extensions },
        b: { doc: this.current, extensions },
        parent,
        // Le viste nascono fuori dal documento: gli stili vanno montati nella shadow root.
        root: this.renderRoot as ShadowRoot,
        collapseUnchanged: collapse,
      });
    }
  }

  private reasonLabel(v: Version): string {
    return t(`history.reason.${v.reason}` as MessageKey);
  }

  override render() {
    const versions = this.versions;
    const selected = versions?.find((v) => v.id === this.selectedId) ?? null;
    return html`
      <header>
        ${icon(icons.history, 18)}
        <h2>${t('history.title', { name: basename(this.path) })}<small>${t('history.keep')}</small></h2>
        <button class="icon-btn small" title=${t('common.close')} @click=${() => this.emit('history-close')}>
          ${icon(icons.close, 18)}
        </button>
      </header>
      ${versions === null
        ? html`<div class="empty">${t('insert.loading')}</div>`
        : versions.length === 0
          ? html`<div class="empty">${this.error ?? t('history.none')}</div>`
          : html`<div class="content">
              <div class="list" role="listbox">
                ${versions.map(
                  (v) => html`<button
                    class="version"
                    role="option"
                    aria-selected=${v.id === this.selectedId}
                    data-id=${v.id}
                    @click=${() => void this.showVersion(v.id)}
                  >
                    <div class="date">${formatVersionDate(v.createdAt)}</div>
                    <div class="sub">${this.reasonLabel(v)} · ${formatSize(v.size)}</div>
                  </button>`,
                )}
              </div>
              <div class="compare">
                ${this.narrowQuery.matches
                  ? html`<div class="labels"><span>${t('history.unifiedLegend')}</span></div>`
                  : html`<div class="labels">
                      <span class="old">${selected ? t('history.versionOf', { date: formatVersionDate(selected.createdAt) }) : ''}</span>
                      <span class="new">${t('history.current')}</span>
                    </div>`}
                ${this.error ? html`<div class="note">${this.error}</div>` : nothing}
                ${this.same && !this.loading ? html`<div class="note">${t('history.same')}</div>` : nothing}
                <div class="merge" ?hidden=${this.same}></div>
                <footer>
                  <span class="hint">${t('history.restoreHint')}</span>
                  <button
                    class="btn primary"
                    data-action="restore"
                    ?disabled=${!selected || this.same || this.loading || !this.canRestore}
                    @click=${() => selected && this.emit('history-restore', { id: selected.id, date: selected.createdAt })}
                  >
                    ${icon(icons.restore, 16)} ${t('history.restore')}
                  </button>
                </footer>
              </div>
            </div>`}
    `;
  }
}

customElements.define('editha-history-panel', EdithaHistoryPanel);
