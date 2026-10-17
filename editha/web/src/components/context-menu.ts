import { LitElement, css, html, nothing } from 'lit';
import { icon } from '../ui/icons.js';
import { sharedStyles } from '../ui/shared-styles.js';

export interface MenuItem {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  danger?: boolean;
  hint?: string;
}

export type MenuEntry = MenuItem | 'separator';

/** Menu contestuale (tasto destro), chiuso da clic esterno, Esc o scroll. */
export class EdithaContextMenu extends LitElement {
  static override properties = {
    items: { state: true },
    x: { state: true },
    y: { state: true },
  };

  declare items: MenuEntry[] | null;
  declare x: number;
  declare y: number;
  private resolve: ((id: string | null) => void) | null = null;

  constructor() {
    super();
    this.items = null;
    this.x = 0;
    this.y = 0;
  }

  static override styles = [
    sharedStyles,
    css`
      .menu {
        position: fixed;
        z-index: 1000;
        min-width: 210px;
        padding: 6px;
        border-radius: var(--radius);
        border: 1px solid var(--border);
        background: var(--surface);
        box-shadow: var(--shadow-pop);
        font-size: 13px;
      }
      button {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        height: 32px;
        padding: 0 10px;
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        text-align: left;
        cursor: pointer;
        color: var(--text);
      }
      button svg {
        color: var(--text-muted);
      }
      button:hover:not(:disabled),
      button:focus-visible {
        background: var(--accent-soft);
        outline: none;
      }
      button.danger,
      button.danger svg {
        color: var(--danger);
      }
      button.danger:hover:not(:disabled) {
        background: var(--danger-soft);
      }
      button:disabled {
        opacity: 0.4;
        cursor: default;
      }
      .hint {
        margin-left: auto;
        color: var(--text-faint);
        font-size: 12px;
      }
      hr {
        border: none;
        border-top: 1px solid var(--border);
        margin: 6px 4px;
      }
    `,
  ];

  private readonly onOutside = (e: Event) => {
    if (!e.composedPath().includes(this)) this.close(null);
  };
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    // Questo Esc chiude solo il menu, non anche il pannello che c'è sotto.
    e.preventDefault();
    this.close(null);
  };
  private readonly onBlur = () => this.close(null);

  show(items: MenuEntry[], x: number, y: number): Promise<string | null> {
    this.close(null);
    this.items = items;
    this.x = x;
    this.y = y;
    window.addEventListener('pointerdown', this.onOutside, true);
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('resize', this.onBlur);
    void this.updateComplete.then(() => {
      // Il menu non deve uscire dalla finestra.
      const menu = this.renderRoot.querySelector('.menu') as HTMLElement | null;
      if (!menu) return;
      const r = menu.getBoundingClientRect();
      this.x = Math.max(8, Math.min(x, window.innerWidth - r.width - 8));
      this.y = Math.max(8, Math.min(y, window.innerHeight - r.height - 8));
      (menu.querySelector('button:not(:disabled)') as HTMLElement | null)?.focus();
    });
    return new Promise((resolve) => (this.resolve = resolve));
  }

  private close(id: string | null): void {
    window.removeEventListener('pointerdown', this.onOutside, true);
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('resize', this.onBlur);
    this.items = null;
    const r = this.resolve;
    this.resolve = null;
    r?.(id);
  }

  private onMenuKey(e: KeyboardEvent): void {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const buttons = [...this.renderRoot.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const i = buttons.indexOf((this.renderRoot as ShadowRoot).activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  override render() {
    if (!this.items) return nothing;
    return html`<div
      class="menu"
      role="menu"
      style="left:${this.x}px;top:${this.y}px"
      @keydown=${this.onMenuKey}
      @contextmenu=${(e: Event) => e.preventDefault()}
    >
      ${this.items.map((item) =>
        item === 'separator'
          ? html`<hr />`
          : html`<button
              role="menuitem"
              class=${item.danger ? 'danger' : ''}
              ?disabled=${item.disabled}
              @click=${() => this.close(item.id)}
            >
              ${item.icon ? icon(item.icon, 16) : html`<span style="width:16px"></span>`}
              <span>${item.label}</span>
              ${item.hint ? html`<span class="hint">${item.hint}</span>` : nothing}
            </button>`,
      )}
    </div>`;
  }
}

customElements.define('editha-context-menu', EdithaContextMenu);
