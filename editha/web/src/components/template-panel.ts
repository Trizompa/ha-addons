import { LitElement, css, html } from 'lit';
import { t } from '../i18n/index.js';
import { basename } from '../state/paths.js';
import { icon, icons } from '../ui/icons.js';
import { sharedStyles } from '../ui/shared-styles.js';

/** Stato dell'anteprima di un template (HA-7). */
export type TemplateView =
  | { status: 'loading' }
  | { status: 'ok'; result: string }
  /** Errore del template (Home Assistant non dice in che riga). */
  | { status: 'syntax' | 'render'; message: string }
  /** Home Assistant non raggiungibile o altro problema: non dipende dal template. */
  | { status: 'failed'; message: string };

/**
 * HA-7: risultato di un template calcolato da Home Assistant, in un pannello sotto l'editor.
 * Verde il risultato, rosso un errore di sintassi, arancione un errore di valutazione.
 */
export class EdithaTemplatePanel extends LitElement {
  static override properties = {
    view: { attribute: false },
    file: { type: String },
    line: { type: Number },
  };

  declare view: TemplateView;
  /** File e prima riga del template mostrato. */
  declare file: string;
  declare line: number;

  constructor() {
    super();
    this.view = { status: 'loading' };
    this.file = '';
    this.line = 1;
  }

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        flex: none;
        max-height: 40%;
        min-height: 0;
        background: var(--surface);
        border-top: 1px solid var(--border);
      }
      header {
        display: flex;
        align-items: center;
        gap: 6px;
        height: 36px;
        padding: 0 6px 0 12px;
        flex: none;
      }
      header h2 {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 0;
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
      }
      .source {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
        color: var(--text-muted);
      }
      .body {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 0 12px 10px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin-bottom: 6px;
        font-size: 12px;
        font-weight: 600;
      }
      .ok .badge {
        color: var(--success);
      }
      .syntax .badge,
      .failed .badge {
        color: var(--danger);
      }
      .render .badge {
        color: var(--warning);
      }
      pre {
        margin: 0;
        padding: 8px 10px;
        border: 1px solid var(--border);
        border-left: 3px solid var(--border);
        border-radius: var(--radius-sm);
        background: var(--editor-bg);
        font-family: var(--font-code);
        font-size: 13px;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .ok pre {
        border-left-color: var(--success);
      }
      .syntax pre,
      .failed pre {
        border-left-color: var(--danger);
      }
      .render pre {
        border-left-color: var(--warning);
      }
      .empty {
        color: var(--text-muted);
        font-style: italic;
      }
      .note {
        margin: 8px 0 0;
        font-size: 12px;
        color: var(--text-muted);
      }
    `,
  ];

  private emit(name: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private renderBody() {
    const v = this.view;
    switch (v.status) {
      case 'loading':
        return html`<p class="note" role="status">${t('template.loading')}</p>`;
      case 'ok':
        return html`<div class="ok" role="status">
          <div class="badge">${icon(icons.ok, 16)} ${t('template.result')}</div>
          <pre>${v.result === '' ? html`<span class="empty">${t('template.emptyResult')}</span>` : v.result}</pre>
        </div>`;
      case 'syntax':
      case 'render':
        return html`<div class=${v.status} role="alert">
          <div class="badge">
            ${icon(v.status === 'syntax' ? icons.alert : icons.warning, 16)}
            ${t(v.status === 'syntax' ? 'template.syntaxError' : 'template.renderError')}
          </div>
          <pre>${v.message}</pre>
        </div>`;
      case 'failed':
        return html`<div class="failed" role="alert">
          <div class="badge">${icon(icons.alert, 16)} ${t('template.failed')}</div>
          <pre>${v.message}</pre>
        </div>`;
    }
  }

  override render() {
    return html`
      <header>
        <h2>${icon(icons.template, 16)} ${t('template.title')}</h2>
        <span class="source" title=${this.file}>${t('template.source', { file: basename(this.file), line: this.line })}</span>
        <button
          class="icon-btn small"
          title=${t('template.refresh')}
          aria-label=${t('template.refresh')}
          ?disabled=${this.view.status === 'loading'}
          @click=${() => this.emit('template-refresh')}
        >
          ${icon(icons.refresh, 16)}
        </button>
        <button class="icon-btn small" title=${t('common.close')} aria-label=${t('common.close')} @click=${() => this.emit('template-close')}>
          ${icon(icons.close, 16)}
        </button>
      </header>
      <div class="body">
        ${this.renderBody()}
        <p class="note">${t('template.note')}</p>
      </div>
    `;
  }
}

customElements.define('editha-template-panel', EdithaTemplatePanel);
