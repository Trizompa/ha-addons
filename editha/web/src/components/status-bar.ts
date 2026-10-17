import { LitElement, css, html, nothing } from 'lit';
import { icon, icons } from '../ui/icons.js';
import { sharedStyles } from '../ui/shared-styles.js';
import { t } from '../i18n/index.js';

export interface StatusInfo {
  path: string;
  line: number;
  column: number;
  selected: number;
  language: string;
  readOnly: boolean;
  dirty: boolean;
  /** null: nessuna validazione per questo linguaggio. */
  /** `skipped`: file troppo grande, il controllo YAML non è stato fatto. */
  lint: { errors: number; warnings: number; skipped?: boolean } | null;
}

/** Barra di stato (UI-1): percorso, posizione, linguaggio, esito della validazione. */
export class EdithaStatusBar extends LitElement {
  static override properties = {
    info: { attribute: false },
    message: { type: String },
    preview: { type: String },
  };

  declare info: StatusInfo | null;
  declare message: string;
  /** FS-10: percorso dell'immagine o del PDF in anteprima. */
  declare preview: string | null;

  constructor() {
    super();
    this.info = null;
    this.message = '';
    this.preview = null;
  }

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        align-items: center;
        gap: 16px;
        height: 28px;
        padding: 0 14px;
        flex: none;
        border-top: 1px solid var(--border);
        background: var(--surface-2);
        color: var(--text-muted);
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
      }
      .path {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        font-family: var(--font-code);
        font-size: 11.5px;
      }
      .item {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .ok {
        color: var(--success);
      }
      .err {
        color: var(--danger);
      }
      .warn {
        color: var(--warning);
      }
      .ro {
        padding: 1px 8px;
        border-radius: 999px;
        background: var(--surface-3);
        color: var(--text-muted);
      }
      @media (max-width: 640px) {
        .hide-narrow {
          display: none;
        }
      }
      button.problems {
        border: none;
        background: transparent;
        font: inherit;
        cursor: pointer;
        border-radius: var(--radius-sm);
      }
      button.problems:hover {
        background: var(--hover);
        text-decoration: underline;
      }
    `,
  ];

  private renderLint(lint: NonNullable<StatusInfo['lint']>) {
    if (lint.skipped) return html`<span class="item">${t('lint.tooLarge')}</span>`;
    if (lint.errors === 0 && lint.warnings === 0) {
      return html`<span class="item ok" title=${t('status.yamlValidTitle')}>${icon(icons.ok, 14)} ${t('status.yamlValid')}</span>`;
    }
    return html`<button
      class="item problems ${lint.errors ? 'err' : 'warn'}"
      title=${t('status.openProblems')}
      @click=${() => this.dispatchEvent(new CustomEvent('open-problems', { bubbles: true, composed: true }))}
    >
      ${icon(lint.errors ? icons.alert : icons.warning, 14)}
      ${lint.errors ? t(lint.errors === 1 ? 'status.errors.one' : 'status.errors.many', { n: lint.errors }) : ''}
      ${lint.errors && lint.warnings ? ' · ' : ''}
      ${lint.warnings ? t(lint.warnings === 1 ? 'status.warnings.one' : 'status.warnings.many', { n: lint.warnings }) : ''}
    </button>`;
  }

  override render() {
    const i = this.info;
    if (this.preview) return html`<span class="path" title=${'/config/' + this.preview}>/config/${this.preview}</span>`;
    if (!i) return html`<span class="path">${this.message || t('status.noFile')}</span>`;
    return html`
      <span class="path" title=${'/config/' + i.path}>/config/${i.path}</span>
      ${this.message ? html`<span class="item">${this.message}</span>` : nothing}
      ${i.readOnly ? html`<span class="item ro">${icon(icons.lock, 12)} ${t('common.readOnly')}</span>` : nothing}
      ${i.lint ? this.renderLint(i.lint) : nothing}
      <span class="item">${t('status.position', { line: i.line, col: i.column })}${i.selected ? t('status.selected', { n: i.selected }) : ''}</span>
      <span class="item hide-narrow">${t('status.spaces')}</span>
      <span class="item hide-narrow">UTF-8</span>
      <span class="item">${i.language === 'Plain text' ? t('lang.text') : i.language}</span>
    `;
  }
}

customElements.define('editha-status-bar', EdithaStatusBar);
