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
  /** ED-19: scheda provvisoria (nome in corsivo). */
  provisional: boolean;
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
    previewFolder: { type: Boolean },
    dragPath: { state: true },
    dropIndex: { state: true },
  };

  declare tabs: TabView[];
  declare active: string | null;
  /** FS-10: immagine o PDF nella tab di anteprima (una sola, riusata). */
  declare preview: string | null;
  /** L'anteprima è la galleria di una cartella (FS-11). */
  declare previewFolder: boolean;
  /** Tab trascinata col mouse (null: nessun trascinamento in corso). */
  declare dragPath: string | null;
  /** Posizione in cui andrebbe la tab trascinata, contando le altre tab. */
  declare dropIndex: number;

  constructor() {
    super();
    this.tabs = [];
    this.active = null;
    this.preview = null;
    this.previewFolder = false;
    this.dragPath = null;
    this.dropIndex = -1;
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
        -webkit-user-select: none;
        -webkit-touch-callout: none;
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
      /* ED-19: il corsivo indica la scheda provvisoria (le modifiche hanno il punto). */
      .tab.provisional .name {
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
      /* Trascinamento col mouse: la tab trascinata sbiadisce, una linea mostra dove andrà. */
      .tab.dragging {
        opacity: 0.5;
      }
      .tab.drop-before::after,
      .tab.drop-after::after {
        content: '';
        position: absolute;
        top: 4px;
        bottom: 4px;
        width: 2px;
        border-radius: 1px;
        background: var(--accent);
      }
      .tab.drop-before::after {
        left: -2px;
      }
      .tab.drop-after::after {
        right: -2px;
      }
    `,
  ];

  override updated(changed: Map<string, unknown>): void {
    if (changed.has('active') && this.active) {
      const el = this.renderRoot.querySelector(`.tab.active`);
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  private emit(name: string, path: string, extra: Record<string, unknown> = {}): void {
    this.dispatchEvent(new CustomEvent(name, { detail: { path, ...extra }, bubbles: true, composed: true }));
  }

  // Pressione prolungata su touch: Safari su iPhone non genera il menu contestuale.
  private pressTimer: ReturnType<typeof setTimeout> | undefined;
  private pressOrigin: { x: number; y: number } | null = null;
  private longPressAt = 0;

  // Trascinamento col mouse per cambiare l'ordine delle tab (issue #11); al tocco resta il menu.
  private drag: { path: string; x: number; id: number; moved: boolean } | null = null;

  private startDrag(e: PointerEvent, path: string): void {
    if (e.pointerType !== 'mouse' || e.button !== 0 || this.tabs.length < 2) return;
    if ((e.target as HTMLElement).closest('.close')) return;
    this.drag = { path, x: e.clientX, id: e.pointerId, moved: false };
  }

  private moveDrag(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.abs(e.clientX - drag.x) < 6) return;
      drag.moved = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      this.dragPath = drag.path;
    }
    // Posizione = quante altre tab hanno il centro a sinistra del puntatore.
    const others = [...this.renderRoot.querySelectorAll<HTMLElement>('.tab:not(.preview)')].filter(
      (el) => el.dataset.path !== drag.path,
    );
    this.dropIndex = others.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.left + r.width / 2 < e.clientX;
    }).length;
    const strip = this.renderRoot.querySelector('.strip') as HTMLElement;
    const r = strip.getBoundingClientRect();
    if (e.clientX < r.left + 24) strip.scrollLeft -= 12;
    else if (e.clientX > r.right - 24) strip.scrollLeft += 12;
  }

  private endDrag(e: PointerEvent, drop: boolean): void {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.id) return;
    this.drag = null;
    if (drag.moved && drop) {
      const from = this.tabs.findIndex((t) => t.path === drag.path);
      if (this.dropIndex !== from) this.emit('tab-move', drag.path, { index: this.dropIndex });
    }
    this.dragPath = null;
    this.dropIndex = -1;
  }

  /** Classe della linea che indica dove finirà la tab trascinata. */
  private dropClass(path: string): string {
    if (this.dragPath === null || path === this.dragPath) return '';
    const others = this.tabs.filter((t) => t.path !== this.dragPath);
    const i = others.findIndex((t) => t.path === path);
    if (i === this.dropIndex) return 'drop-before';
    if (i === others.length - 1 && this.dropIndex === others.length) return 'drop-after';
    return '';
  }

  private onPointerDown(e: PointerEvent, path: string): void {
    this.startDrag(e, path);
    if (e.pointerType !== 'touch') return;
    const x = e.clientX;
    const y = e.clientY;
    this.cancelPress();
    this.pressOrigin = { x, y };
    this.pressTimer = setTimeout(() => {
      this.pressOrigin = null;
      this.longPressAt = Date.now();
      this.emit('tab-context', path, { x, y });
    }, 500);
  }

  private onPointerMove(e: PointerEvent): void {
    this.moveDrag(e);
    if (!this.pressOrigin) return;
    if (Math.hypot(e.clientX - this.pressOrigin.x, e.clientY - this.pressOrigin.y) > 10) this.cancelPress();
  }

  private cancelPress(): void {
    clearTimeout(this.pressTimer);
    this.pressOrigin = null;
  }

  /** Il clic che chiude una pressione prolungata non attiva la tab. */
  private pressedLong(): boolean {
    return Date.now() - this.longPressAt < 800;
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
          const dragged = tab.path === this.dragPath;
          return html`<div
            class="tab ${active ? 'active' : ''} ${tab.dirty ? 'dirty' : ''} ${tab.provisional ? 'provisional' : ''} ${dragged
              ? 'dragging'
              : ''} ${this.dropClass(tab.path)}"
            role="tab"
            aria-selected=${active}
            title=${tab.path + (tab.dirty ? t('tabs.modified') : '') + (tab.provisional ? t('tabs.provisional') : '')}
            data-path=${tab.path}
            @click=${() => !this.pressedLong() && this.emit('tab-activate', tab.path)}
            @dblclick=${() => this.emit('tab-pin', tab.path)}
            @contextmenu=${(e: MouseEvent) => {
              e.preventDefault();
              // Su Android il menu nativo può arrivare prima della pressione prolungata: una volta sola.
              this.cancelPress();
              if (!this.pressedLong()) this.emit('tab-context', tab.path, { x: e.clientX, y: e.clientY });
            }}
            @pointerdown=${(e: PointerEvent) => this.onPointerDown(e, tab.path)}
            @pointermove=${(e: PointerEvent) => this.onPointerMove(e)}
            @pointerup=${(e: PointerEvent) => {
              this.cancelPress();
              this.endDrag(e, true);
            }}
            @pointercancel=${(e: PointerEvent) => {
              this.cancelPress();
              this.endDrag(e, false);
            }}
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
    // Una cartella è la galleria delle sue immagini (FS-11).
    const fi = this.previewFolder ? { path: icons.folder, color: 'var(--folder, #e5b33a)' } : fileIcon(name);
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
