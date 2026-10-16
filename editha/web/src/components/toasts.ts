import { LitElement, css, html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { icon, icons } from '../ui/icons.js';
import { sharedStyles } from '../ui/shared-styles.js';
import { t } from '../i18n/index.js';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const ICONS: Record<ToastKind, string> = {
  success: icons.ok,
  error: icons.alert,
  warning: icons.warning,
  info: icons.info,
};

/** Notifiche non bloccanti (UI-4). */
export class EdithaToasts extends LitElement {
  static override properties = { toasts: { state: true } };
  declare toasts: Toast[];
  private next = 1;

  constructor() {
    super();
    this.toasts = [];
  }

  static override styles = [
    sharedStyles,
    css`
      :host {
        position: fixed;
        right: 16px;
        bottom: 40px;
        z-index: 900;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 8px;
        pointer-events: none;
        max-width: calc(100vw - 32px);
      }
      .toast {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 220px;
        max-width: 420px;
        padding: 10px 8px 10px 12px;
        border-radius: var(--radius);
        border: 1px solid var(--border);
        border-left: 4px solid var(--accent);
        background: var(--surface);
        box-shadow: var(--shadow-pop);
        font-size: 13px;
        pointer-events: auto;
        animation: enter 0.18s ease-out;
      }
      .toast.success {
        border-left-color: var(--success);
      }
      .toast.success svg {
        color: var(--success);
      }
      .toast.error {
        border-left-color: var(--danger);
      }
      .toast.error svg {
        color: var(--danger);
      }
      .toast.warning {
        border-left-color: var(--warning);
      }
      .toast.warning svg {
        color: var(--warning);
      }
      .toast.info svg {
        color: var(--accent);
      }
      .msg {
        flex: 1;
        line-height: 1.4;
      }
      @keyframes enter {
        from {
          opacity: 0;
          transform: translateY(6px);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .toast {
          animation: none;
        }
      }
    `,
  ];

  show(message: string, kind: ToastKind = 'info'): void {
    const toast = { id: this.next++, kind, message };
    this.toasts = [...this.toasts.slice(-3), toast];
    setTimeout(() => this.dismiss(toast.id), kind === 'error' ? 7000 : 3500);
  }

  private dismiss(id: number): void {
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }

  override render() {
    return repeat(
      this.toasts,
      (toast) => toast.id,
      (toast) => html`<div class="toast ${toast.kind}" role=${toast.kind === 'error' ? 'alert' : 'status'}>
        ${icon(ICONS[toast.kind], 18)}
        <span class="msg">${toast.message}</span>
        <button class="icon-btn small" title=${t('common.close')} @click=${() => this.dismiss(toast.id)}>
          ${icon(icons.close, 16)}
        </button>
      </div>`,
    );
  }
}

customElements.define('editha-toasts', EdithaToasts);
