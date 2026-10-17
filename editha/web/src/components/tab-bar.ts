import { LitElement, css, html, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { fileIcon, icon, icons } from '../ui/icons.js';
import { sharedStyles } from '../ui/shared-styles.js';
import { t } from '../i18n/index.js';
import { shortcutLabel } from '../state/keys.js';

export interface TabView {
  path: string;
  name: string;
  dirty: boolean;
  readOnly: boolean;
}

/**
 * Barra delle tab. La tab attiva ha lo stesso colore dell'editor e un bordo
 * colorato; le altre sono più tenui: stesso linguaggio dei pulsanti (FEP #15).
 */
export class EdithaTabBar extends LitElement {
  static override properties = {
    tabs: { attribute: false },
    active: { type: String },
    preview: { type: String },
  };

  declare tabs: TabView[];
  declare active: string | null;
  /** FS-10: immagine o PDF nella tab di anteprima (una sola, riusata). */
  declare preview: string | null;

  constructor() {
    super();
    this.tabs = [];
    this.active = null;
    this.preview = null;
  }

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        flex: none;
        background: var(--surface-2);
        border-bottom: 1px solid var(--border);
      }
      .strip {
        display: flex;
        align-items: flex-end;
        gap: 2px;
        height: 40px;
        padding: 0 8px;
        overflow-x: auto;
        overflow-y: hidden;
        scrollbar-width: thin;
      }
      .tab {
        position: relative;
        display: flex;
        align-items: center;
        gap: 6px;
        height: 34px;
        max-width: 240px;
        padding: 0 6px 0 12px;
        border: 1px solid transparent;
        border-bottom: none;
        border-radius: var(--radius) var(--radius) 0 0;
        background: transparent;
        color: var(--text-muted);
        font-size: 13px;
        cursor: pointer;
        user-select: none;
        flex: none;
      }
      .tab:hover {
        background: var(--hover);
        color: var(--text);
      }
      .tab.active {
        background: var(--editor-bg);
        border-color: var(--border);
        color: var(--text);
        font-weight: 500;
        margin-bottom: -1px;
        height: 35px;
      }
      .tab.active::before {
        content: '';
        position: absolute;
        left: 8px;
        right: 8px;
        top: -1px;
        height: 2px;
        border-radius: 0 0 2px 2px;
        background: var(--accent);
      }
      .tab-icon {
        display: inline-flex;
        flex: none;
      }
      .name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tab.dirty .name {
        font-style: italic;
      }
      .end {
        position: relative;
        display: inline-flex;
        width: 22px;
        height: 22px;
        flex: none;
      }
      .close {
        width: 22px;
        height: 22px;
        opacity: 0;
      }
      .tab.active .close,
      .tab:hover .close,
      .close:focus-visible {
        opacity: 1;
      }
      .dot {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
      }
      .dot::after {
        content: '';
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--accent);
      }
      /* Con modifiche non salvate il punto prende il posto della X, che riappare al passaggio. */
      .tab.dirty .close {
        opacity: 0;
      }
      .tab.dirty:hover .close,
      .tab.dirty .close:focus-visible {
        opacity: 1;
      }
      .tab.dirty:hover .dot {
        display: none;
      }
      .lock {
        display: inline-flex;
        color: var(--text-faint);
      }
    `,
  ];

  override updated(changed: Map<string, unknown>): void {
    if (changed.has('active') && this.active) {
      const el = this.renderRoot.querySelector(`.tab.active`);
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  private emit(name: string, path: string): void {
    this.dispatchEvent(new CustomEvent(name, { detail: { path }, bubbles: true, composed: true }));
  }

  override render() {
    return html`<div
      class="strip"
      role="tablist"
      @wheel=${(e: WheelEvent) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          (e.currentTarget as HTMLElement).scrollLeft += e.deltaY;
        }
      }}
    >
      ${repeat(
        this.tabs,
        (tab) => tab.path,
        (tab) => {
          const fi = fileIcon(tab.name);
          const active = tab.path === this.active;
          return html`<div
            class="tab ${active ? 'active' : ''} ${tab.dirty ? 'dirty' : ''}"
            role="tab"
            aria-selected=${active}
            title=${tab.path + (tab.dirty ? t('tabs.modified') : '')}
            data-path=${tab.path}
            @click=${() => this.emit('tab-activate', tab.path)}
            @auxclick=${(e: MouseEvent) => {
              if (e.button === 1) this.emit('tab-close', tab.path);
            }}
            @mousedown=${(e: MouseEvent) => {
              if (e.button === 1) e.preventDefault();
            }}
          >
            <span class="tab-icon" style="color:${fi.color}">${icon(fi.path, 16)}</span>
            <span class="name">${tab.name}</span>
            ${tab.readOnly ? html`<span class="lock" title=${t('common.readOnly')}>${icon(icons.lock, 12)}</span>` : nothing}
            <span class="end">
              ${tab.dirty ? html`<span class="dot"></span>` : nothing}
              <button
                class="icon-btn small close"
                title=${shortcutLabel(t('tabs.close'))}
                aria-label=${t('tabs.closeName', { name: tab.name })}
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this.emit('tab-close', tab.path);
                }}
              >
                ${icon(icons.close, 15)}
              </button>
            </span>
          </div>`;
        },
      )}
      ${this.preview ? this.renderPreview(this.preview) : nothing}
    </div>`;
  }

  private renderPreview(path: string) {
    const name = path.split('/').pop() ?? path;
    const fi = fileIcon(name);
    const active = path === this.active;
    return html`<div
      class="tab preview ${active ? 'active' : ''}"
      role="tab"
      aria-selected=${active}
      title=${path}
      data-path=${path}
      @click=${() => this.emit('preview-activate', path)}
      @auxclick=${(e: MouseEvent) => {
        if (e.button === 1) this.emit('preview-close', path);
      }}
      @mousedown=${(e: MouseEvent) => {
        if (e.button === 1) e.preventDefault();
      }}
    >
      <span class="tab-icon" style="color:${fi.color}">${icon(fi.path, 16)}</span>
      <span class="name">${name}</span>
      <span class="end">
        <button
          class="icon-btn small close"
          title=${shortcutLabel(t('tabs.close'))}
          aria-label=${t('tabs.closeName', { name })}
          @click=${(e: Event) => {
            e.stopPropagation();
            this.emit('preview-close', path);
          }}
        >
          ${icon(icons.close, 15)}
        </button>
      </span>
    </div>`;
  }
}

customElements.define('editha-tab-bar', EdithaTabBar);
