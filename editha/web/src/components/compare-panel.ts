import { LitElement, css, html, nothing } from 'lit';
import { EditorView } from '@codemirror/view';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import { viewerExtensions, type EditorPrefs } from '../editor/setup.js';
import { t } from '../i18n/index.js';
import { icon, icons } from '../ui/icons.js';
import { sharedStyles } from '../ui/shared-styles.js';

const NARROW = '(max-width: 760px)';

export interface CompareSide {
  path: string;
  content: string;
}

/**
 * BK-6: confronto tra due file qualsiasi, in sola lettura. Affiancati su schermi larghi,
 * in un'unica colonna su telefono (rosso: solo nel primo, verde: solo nel secondo).
 */
export class EdithaComparePanel extends LitElement {
  static override properties = {
    left: { attribute: false },
    right: { attribute: false },
    prefs: { attribute: false },
  };

  declare left: CompareSide;
  declare right: CompareSide;
  declare prefs: EditorPrefs;

  private merge: MergeView | EditorView | null = null;
  private readonly narrowQuery = window.matchMedia(NARROW);

  constructor() {
    super();
    this.left = { path: '', content: '' };
    this.right = { path: '', content: '' };
    this.prefs = { wordWrap: false, fontSize: 14 };
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
      .labels {
        display: grid;
        grid-template-columns: 1fr 1fr;
        font-size: 12px;
        border-bottom: 1px solid var(--border);
        background: var(--surface-2, var(--surface));
      }
      .labels span {
        padding: 6px 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .labels .a {
        color: var(--danger);
      }
      .labels .b {
        color: var(--success);
      }
      .note {
        padding: 12px 14px;
        font-size: 13px;
        color: var(--text-muted);
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
      @media (max-width: 760px) {
        .labels {
          grid-template-columns: 1fr;
        }
      }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    this.narrowQuery.addEventListener('change', this.build);
  }

  override disconnectedCallback(): void {
    this.narrowQuery.removeEventListener('change', this.build);
    this.merge?.destroy();
    this.merge = null;
    super.disconnectedCallback();
  }

  override firstUpdated(): void {
    this.build();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has('left') || changed.has('right')) this.build();
  }

  private readonly build = (): void => {
    this.merge?.destroy();
    this.merge = null;
    const parent = this.renderRoot.querySelector('.merge') as HTMLElement | null;
    if (!parent || !this.left.path || !this.right.path) return;
    const collapse = { margin: 3, minSize: 6 };
    const root = this.renderRoot as ShadowRoot;
    if (this.narrowQuery.matches) {
      this.merge = new EditorView({
        doc: this.right.content,
        extensions: [
          viewerExtensions(this.right.path, this.prefs),
          unifiedMergeView({ original: this.left.content, mergeControls: false, collapseUnchanged: collapse }),
        ],
        parent,
        root,
      });
    } else {
      this.merge = new MergeView({
        a: { doc: this.left.content, extensions: viewerExtensions(this.left.path, this.prefs) },
        b: { doc: this.right.content, extensions: viewerExtensions(this.right.path, this.prefs) },
        parent,
        root,
        collapseUnchanged: collapse,
      });
    }
  };

  override render() {
    const same = this.left.content === this.right.content;
    return html`
      <header>
        ${icon(icons.compare, 18)}
        <h2>${t('compare.title', { a: this.left.path, b: this.right.path })}</h2>
        <button class="icon-btn small" title=${t('common.close')} @click=${() =>
          this.dispatchEvent(new CustomEvent('compare-close', { bubbles: true, composed: true }))}>
          ${icon(icons.close, 18)}
        </button>
      </header>
      ${this.narrowQuery.matches
        ? html`<div class="labels"><span>${t('compare.legend', { a: this.left.path, b: this.right.path })}</span></div>`
        : html`<div class="labels">
            <span class="a" title=${this.left.path}>/config/${this.left.path}</span>
            <span class="b" title=${this.right.path}>/config/${this.right.path}</span>
          </div>`}
      ${same ? html`<div class="note">${t('compare.same')}</div>` : nothing}
      <div class="merge"></div>
    `;
  }
}

customElements.define('editha-compare-panel', EdithaComparePanel);
