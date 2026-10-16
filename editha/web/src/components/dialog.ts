import { LitElement, css, html, nothing } from 'lit';
import { sharedStyles } from '../ui/shared-styles.js';
import { t } from '../i18n/index.js';

export interface Choice {
  id: string;
  label: string;
  variant?: 'primary' | 'danger' | 'default';
}

interface Pending {
  title: string;
  message?: string;
  /** Testo preformattato, es. gli errori restituiti da Home Assistant. */
  detail?: string;
  input?: { label: string; value: string; selectUntil?: number; validate?: (v: string) => string | null };
  choices: Choice[];
  /** Scelta del tasto Invio. */
  defaultId: string;
  resolve: (result: { id: string | null; value: string }) => void;
}

/**
 * Finestre modali con API a promesse: conferme, scelte e richiesta di un nome.
 * Basata su <dialog>, quindi Esc e il focus funzionano come ci si aspetta.
 */
export class EdithaDialog extends LitElement {
  static override properties = {
    pending: { state: true },
    error: { state: true },
  };

  declare pending: Pending | null;
  declare error: string | null;

  constructor() {
    super();
    this.pending = null;
    this.error = null;
  }

  static override styles = [
    sharedStyles,
    css`
      dialog {
        width: min(440px, calc(100vw - 32px));
        padding: 0;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        background: var(--surface);
        color: var(--text);
        box-shadow: var(--shadow-pop);
      }
      dialog::backdrop {
        background: var(--scrim);
        backdrop-filter: blur(2px);
      }
      form {
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 20px;
        margin: 0;
      }
      h2 {
        margin: 0;
        font-size: 17px;
        font-weight: 600;
      }
      p {
        margin: 0;
        color: var(--text-muted);
        line-height: 1.5;
        white-space: pre-line;
      }
      label {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 13px;
        color: var(--text-muted);
      }
      pre {
        margin: 0;
        max-height: 50vh;
        overflow: auto;
        padding: 10px 12px;
        border-radius: var(--radius-sm);
        background: var(--surface-3);
        color: var(--text);
        font: 12px/1.5 var(--font-code);
        white-space: pre-wrap;
        word-break: break-word;
      }
      .error {
        color: var(--danger);
        font-size: 12px;
        min-height: 16px;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 4px;
      }
    `,
  ];

  /** Una finestra è aperta e aspetta una risposta. */
  get busy(): boolean {
    return !!this.pending;
  }

  private open(p: Omit<Pending, 'resolve'>): Promise<{ id: string | null; value: string }> {
    // Una finestra alla volta: quella precedente viene annullata.
    this.pending?.resolve({ id: null, value: '' });
    return new Promise((resolve) => {
      this.error = null;
      this.pending = { ...p, resolve };
      void this.updateComplete.then(() => {
        const dialog = this.renderRoot.querySelector('dialog');
        if (!dialog) return;
        if (!dialog.open) dialog.showModal();
        const input = this.renderRoot.querySelector('input');
        if (input) {
          input.focus();
          input.setSelectionRange(0, p.input?.selectUntil ?? input.value.length);
        } else {
          (this.renderRoot.querySelector(`[data-id="${p.defaultId}"]`) as HTMLElement | null)?.focus();
        }
      });
    });
  }

  private finish(id: string | null): void {
    const p = this.pending;
    if (!p) return;
    const input = this.renderRoot.querySelector('input');
    const value = input?.value.trim() ?? '';
    if (id !== null && p.input?.validate) {
      const error = p.input.validate(value);
      if (error) {
        this.error = error;
        input?.focus();
        return;
      }
    }
    this.pending = null;
    this.renderRoot.querySelector('dialog')?.close();
    p.resolve({ id, value });
  }

  async confirm(opts: { title: string; message: string; confirmLabel: string; danger?: boolean }): Promise<boolean> {
    const res = await this.open({
      title: opts.title,
      message: opts.message,
      choices: [
        { id: 'cancel', label: t('common.cancel') },
        { id: 'ok', label: opts.confirmLabel, variant: opts.danger ? 'danger' : 'primary' },
      ],
      defaultId: 'ok',
    });
    return res.id === 'ok';
  }

  /** Solo informazioni, con un pulsante per chiudere. */
  async inform(opts: { title: string; message?: string; detail?: string; okLabel?: string }): Promise<void> {
    await this.open({
      title: opts.title,
      ...(opts.message ? { message: opts.message } : {}),
      ...(opts.detail ? { detail: opts.detail } : {}),
      choices: [{ id: 'ok', label: opts.okLabel ?? t('common.close'), variant: 'primary' }],
      defaultId: 'ok',
    });
  }

  async choose(opts: {
    title: string;
    message: string;
    detail?: string;
    choices: Choice[];
    defaultId: string;
  }): Promise<string | null> {
    const res = await this.open(opts);
    return res.id === 'cancel' ? null : res.id;
  }

  async prompt(opts: {
    title: string;
    /** Spiegazione sopra il campo. */
    message?: string;
    label: string;
    value?: string;
    confirmLabel: string;
    selectUntil?: number;
    validate?: (v: string) => string | null;
  }): Promise<string | null> {
    const res = await this.open({
      title: opts.title,
      ...(opts.message ? { message: opts.message } : {}),
      input: {
        label: opts.label,
        value: opts.value ?? '',
        ...(opts.selectUntil !== undefined ? { selectUntil: opts.selectUntil } : {}),
        ...(opts.validate ? { validate: opts.validate } : {}),
      },
      choices: [
        { id: 'cancel', label: t('common.cancel') },
        { id: 'ok', label: opts.confirmLabel, variant: 'primary' },
      ],
      defaultId: 'ok',
    });
    return res.id === 'ok' ? res.value : null;
  }

  override render() {
    const p = this.pending;
    return html`
      <dialog
        @cancel=${(e: Event) => {
          e.preventDefault();
          this.finish(null);
        }}
      >
        ${p
          ? html`<form
              method="dialog"
              @submit=${(e: Event) => {
                e.preventDefault();
                this.finish(p.defaultId);
              }}
            >
              <h2>${p.title}</h2>
              ${p.message ? html`<p>${p.message}</p>` : nothing}
              ${p.detail ? html`<pre>${p.detail}</pre>` : nothing}
              ${p.input
                ? html`<label>
                    ${p.input.label}
                    <input
                      class="input ${this.error ? 'invalid' : ''}"
                      .value=${p.input.value}
                      spellcheck="false"
                      autocomplete="off"
                      @input=${() => (this.error = null)}
                    />
                    <span class="error">${this.error ?? ''}</span>
                  </label>`
                : nothing}
              <div class="actions">
                ${p.choices.map(
                  (c) => html`<button
                    type="button"
                    class="btn ${c.variant ?? ''}"
                    data-id=${c.id}
                    @click=${() => this.finish(c.id === 'cancel' ? null : c.id)}
                  >
                    ${c.label}
                  </button>`,
                )}
              </div>
            </form>`
          : nothing}
      </dialog>
    `;
  }
}

customElements.define('editha-dialog', EdithaDialog);
