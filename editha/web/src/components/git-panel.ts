import { LitElement, css, html, nothing } from 'lit';
import { api, errorText, type GitInfo } from '../api/client.js';
import { t } from '../i18n/index.js';
import { icon, icons } from '../ui/icons.js';
import { sharedStyles } from '../ui/shared-styles.js';
import { formatVersionDate } from './history-panel.js';

/**
 * GIT-1…6: Git locale sulla cartella /config, nella barra laterale al posto dell'albero.
 * Solo il repository su questo Home Assistant: niente viene inviato fuori.
 */
export class EdithaGitPanel extends LitElement {
  static override properties = {
    info: { state: true },
    error: { state: true },
    busy: { state: true },
  };

  declare info: GitInfo | null;
  declare error: string | null;
  declare busy: boolean;
  /** Caricamento in corso: una risposta vecchia non sostituisce quella nuova. */
  private loadToken = 0;

  constructor() {
    super();
    this.info = null;
    this.error = null;
    this.busy = false;
  }

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        min-height: 0;
        height: 100%;
      }
      :host([hidden]) {
        display: none;
      }
      header {
        display: flex;
        align-items: center;
        gap: 6px;
        height: 40px;
        padding: 0 6px 0 14px;
        flex: none;
      }
      header h2 {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 1;
        margin: 0;
        font-size: 13px;
        font-weight: 600;
      }
      .body {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 0 14px 14px;
        font-size: 13px;
      }
      p {
        margin: 0 0 10px;
        line-height: 1.45;
      }
      .muted {
        color: var(--text-muted);
      }
      .warn {
        color: var(--danger);
      }
      ul {
        margin: 0 0 12px;
        padding-left: 18px;
        color: var(--text-muted);
      }
      li {
        margin-bottom: 2px;
      }
      .card {
        margin-bottom: 12px;
        padding: 10px 12px;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--editor-bg);
      }
      .card .label {
        font-size: 11px;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .card .value {
        margin-top: 2px;
        overflow-wrap: anywhere;
      }
      code {
        font-family: var(--font-code);
        font-size: 12px;
      }
    `,
  ];

  /** Rilegge lo stato del repository (all'apertura del pannello e dopo un'operazione). */
  async load(): Promise<void> {
    const token = ++this.loadToken;
    this.error = null;
    try {
      const info = await api.git.info();
      if (token === this.loadToken) this.info = info;
    } catch (err) {
      if (token === this.loadToken) this.error = errorText(err);
    }
  }

  /** Il focus entra nel pannello (sul primo pulsante). */
  focusPanel(): void {
    this.renderRoot.querySelector<HTMLButtonElement>('header button')?.focus();
  }

  private emit(name: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private async init(): Promise<void> {
    this.busy = true;
    try {
      const res = await api.git.init();
      this.loadToken++;
      this.info = res.info;
      this.emit('git-changed', { message: res.gitignoreCreated ? t('git.initDone') : t('git.initDoneKept') });
    } catch (err) {
      this.emit('git-error', { message: errorText(err) });
      await this.load();
    } finally {
      this.busy = false;
    }
  }

  private async createGitignore(): Promise<void> {
    this.busy = true;
    try {
      const res = await api.git.gitignore();
      this.loadToken++;
      this.info = res.info;
      this.emit('git-changed', { message: res.created ? t('git.gitignoreDone') : t('git.gitignoreKept') });
    } catch (err) {
      this.emit('git-error', { message: errorText(err) });
    } finally {
      this.busy = false;
    }
  }

  private renderIgnored() {
    return html`<p class="muted">${t('git.ignoredIntro')}</p>
      <ul>
        <li>${t('git.ignoredSecrets')}</li>
        <li>${t('git.ignoredInternal')}</li>
        <li>${t('git.ignoredDb')}</li>
        <li>${t('git.ignoredTemp')}</li>
      </ul>`;
  }

  private renderBody() {
    if (this.error) return html`<p class="warn" role="alert">${this.error}</p>`;
    const info = this.info;
    if (!info) return html`<p class="muted" role="status">${t('insert.loading')}</p>`;
    if (!info.available) return html`<p class="warn">${t('git.unavailable')}</p>`;
    if (info.repo === 'broken') return html`<p class="warn">${t('git.broken')}</p>`;
    if (info.repo === 'none') {
      return html`
        <p>${t('git.noneIntro')}</p>
        <p class="muted">${t('git.localOnly')}</p>
        ${info.gitignore ? html`<p class="muted">${t('git.gitignoreExists')}</p>` : this.renderIgnored()}
        <button class="btn primary" data-action="git-init" ?disabled=${this.busy} @click=${() => void this.init()}>
          ${icon(icons.git, 16)} ${t('git.init')}
        </button>
      `;
    }
    return html`
      <div class="card">
        <div class="label">${t('git.branch')}</div>
        <div class="value">${info.branch ?? t('git.detached')}</div>
      </div>
      <div class="card">
        <div class="label">${t('git.lastCommit')}</div>
        <div class="value">
          ${info.head
            ? html`${info.head.subject}<br /><span class="muted"
                  ><code>${info.head.hash.slice(0, 7)}</code> · ${formatVersionDate(info.head.date)}</span
                >`
            : html`<span class="muted">${t('git.noCommits')}</span>`}
        </div>
      </div>
      ${info.gitignore
        ? nothing
        : html`<p>${t('git.noGitignore')}</p>
            ${this.renderIgnored()}
            <button class="btn" data-action="git-gitignore" ?disabled=${this.busy} @click=${() => void this.createGitignore()}>
              ${t('git.createGitignore')}
            </button>`}
      <p class="muted">${t('git.localOnly')}</p>
    `;
  }

  override render() {
    return html`
      <header
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            this.emit('git-close');
          }
        }}
      >
        <h2>${icon(icons.git, 16)} Git</h2>
        <button class="icon-btn small" title=${t('tree.refresh')} aria-label=${t('tree.refresh')} @click=${() => void this.load()}>
          ${icon(icons.refresh, 16)}
        </button>
        <button class="icon-btn small" title=${t('common.close')} aria-label=${t('common.close')} @click=${() => this.emit('git-close')}>
          ${icon(icons.close, 16)}
        </button>
      </header>
      <div
        class="body"
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            this.emit('git-close');
          }
        }}
      >
        ${this.renderBody()}
      </div>
    `;
  }
}

customElements.define('editha-git-panel', EdithaGitPanel);
