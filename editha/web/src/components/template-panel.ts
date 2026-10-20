import { LitElement, css, html, nothing } from 'lit';
import { t } from '../i18n/index.js';
import { basename } from '../state/paths.js';
import { icon, icons } from '../ui/icons.js';
import { sharedStyles } from '../ui/shared-styles.js';

/** Stato dell'anteprima di un template (HA-7). */
export type TemplateView =
  | { status: 'loading' }
  /** `missing`: entità citate nel template che Home Assistant non ha. */
  | { status: 'ok'; result: string; missing: string[] }
  | { status: 'render'; message: string; missing: string[] }
  /** `line`: riga del file trovata da EDITHA (Home Assistant non la indica), se si trova. */
  | { status: 'syntax'; message: string; line: number | null }
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
    updating: { type: Boolean },
    copied: { state: true },
  };

  declare view: TemplateView;
  /** File e prima riga del template mostrato. */
  declare file: string;
  declare line: number;
  /** Aggiornamento automatico in corso: il risultato mostrato resta finché arriva il nuovo. */
  declare updating: boolean;
  declare copied: boolean;
  private copiedTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    this.updating = false;
    this.copied = false;
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
      .missing {
        margin: 8px 0 0;
        padding: 6px 10px;
        border-radius: var(--radius-sm);
        background: var(--danger-soft);
        font-size: 12px;
      }
      .missing code {
        font-family: var(--font-code);
      }
      .actions {
        display: flex;
        gap: 6px;
        margin-top: 6px;
      }
      .updating {
        font-size: 12px;
        color: var(--text-muted);
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
          <div class="actions">
            <button class="btn" data-action="template-copy" ?disabled=${v.result === ''} @click=${() => void this.copy(v.result)}>
              ${icon(this.copied ? icons.ok : icons.copy, 16)} ${this.copied ? t('template.copied') : t('template.copy')}
            </button>
          </div>
          ${this.renderMissing(v.missing)}
        </div>`;
      case 'render':
        return html`<div class="render" role="alert">
          <div class="badge">${icon(icons.warning, 16)} ${t('template.renderError')}</div>
          <pre>${v.message}</pre>
          ${this.renderMissing(v.missing)}
        </div>`;
      case 'syntax':
        return html`<div class="syntax" role="alert">
          <div class="badge">${icon(icons.alert, 16)} ${t('template.syntaxError')}</div>
          <pre>${v.message}</pre>
          ${v.line !== null
            ? html`<div class="actions">
                <button class="btn" data-action="template-goto" ?disabled=${this.updating} @click=${() => this.emit('template-goto', { line: v.line })}>
                  ${t('template.goToLine', { line: v.line })}
                </button>
              </div>`
            : nothing}
        </div>`;
      case 'failed':
        return html`<div class="failed" role="alert">
          <div class="badge">${icon(icons.alert, 16)} ${t('template.failed')}</div>
          <pre>${v.message}</pre>
        </div>`;
    }
  }

  private renderMissing(missing: string[]) {
    if (missing.length === 0) return nothing;
    return html`<p class="missing">
      ${icon(icons.warning, 14)} ${t(missing.length === 1 ? 'template.missingOne' : 'template.missingMany')}
      ${missing.map((id, i) => html`${i > 0 ? ', ' : ''}<code>${id}</code>`)}
    </p>`;
  }

  /** Copia il risultato; se il browser non lo permette (pagina in un iframe), prova alla vecchia maniera. */
  private async copy(text: string): Promise<void> {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      const button = this.renderRoot.querySelector<HTMLButtonElement>('button[data-action="template-copy"]');
      const area = document.createElement('textarea');
      area.value = text;
      area.readOnly = true;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      this.renderRoot.appendChild(area);
      area.focus();
      area.select();
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      area.remove();
      // Il focus torna sul pulsante, non sulla pagina.
      button?.focus();
    }
    if (!ok) return void this.emit('template-copy-failed');
    this.copied = true;
    clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => (this.copied = false), 1500);
  }

  override render() {
    return html`
      <header>
        <h2>${icon(icons.template, 16)} ${t('template.title')}</h2>
        <span class="source" title=${this.file}>${t('template.source', { file: basename(this.file), line: this.line })}</span>
        ${this.updating ? html`<span class="updating" role="status">${t('template.updating')}</span>` : nothing}
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
