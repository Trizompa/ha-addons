import { LitElement, css, html, nothing } from 'lit';
import { api, errorText, type HistoryUsageInfo } from '../api/client.js';
import { t } from '../i18n/index.js';
import { icon, icons } from '../ui/icons.js';
import { sharedStyles } from '../ui/shared-styles.js';
import { formatCount, formatSize, formatVersionDate } from './history-panel.js';

/**
 * BK-7: spazio occupato dalla cronologia, in tutto e file per file. Le copie stanno nella
 * cartella dei dati di Editha: qui si guarda soltanto, i file di /config non si toccano.
 */
export class EdithaHistorySpace extends LitElement {
  static override properties = {
    usage: { state: true },
    error: { state: true },
  };

  declare usage: HistoryUsageInfo | null;
  declare error: string | null;

  constructor() {
    super();
    this.usage = null;
    this.error = null;
  }

  static override styles = [
    sharedStyles,
    css`
      dialog {
        width: min(620px, calc(100vw - 32px));
        max-height: calc(100vh - 48px);
        padding: 20px 22px 16px;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        background: var(--surface);
        color: var(--text);
        box-shadow: var(--shadow-pop);
      }
      dialog[open] {
        display: flex;
        flex-direction: column;
      }
      dialog::backdrop {
        background: var(--scrim);
        backdrop-filter: blur(2px);
      }
      h2 {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 0 12px;
        font-size: 17px;
      }
      .summary {
        margin: 0 0 6px;
        font-size: 14px;
      }
      .summary strong {
        font-size: 16px;
      }
      .note {
        margin: 0 0 12px;
        color: var(--text-muted);
        font-size: 12px;
        line-height: 1.5;
      }
      .list {
        flex: 1;
        min-height: 0;
        overflow: auto;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      th,
      td {
        padding: 6px 10px;
        text-align: left;
        border-bottom: 1px solid var(--border);
        white-space: nowrap;
      }
      th {
        position: sticky;
        top: 0;
        background: var(--surface);
        color: var(--text-muted);
        font-weight: 500;
        font-size: 12px;
      }
      td.path {
        white-space: normal;
        overflow-wrap: anywhere;
      }
      td.num {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .tag {
        margin-left: 6px;
        padding: 1px 6px;
        border-radius: 999px;
        background: var(--hover);
        color: var(--text-muted);
        font-size: 11px;
      }
      .more {
        padding: 8px 10px;
        color: var(--text-muted);
        font-size: 12px;
      }
      .empty {
        padding: 16px 0;
        color: var(--text-muted);
        font-size: 13px;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 14px;
      }
      @media (max-width: 760px) {
        th.date,
        td.date {
          display: none;
        }
      }
    `,
  ];

  /** Una risposta lenta di un'apertura precedente non sostituisce quella nuova. */
  private loadToken = 0;

  async show(): Promise<void> {
    const token = ++this.loadToken;
    this.usage = null;
    this.error = null;
    await this.updateComplete;
    (this.renderRoot.querySelector('dialog') as HTMLDialogElement).showModal();
    try {
      const usage = await api.historyUsage();
      if (token === this.loadToken) this.usage = usage;
    } catch (err) {
      if (token === this.loadToken) this.error = errorText(err);
    }
  }

  private close(): void {
    (this.renderRoot.querySelector('dialog') as HTMLDialogElement).close();
  }

  private renderUsage(u: HistoryUsageInfo) {
    // Vuota davvero solo se non c'è nemmeno spazio occupato (avanzi di scritture interrotte).
    if (u.versions === 0 && u.totalBytes < 64 * 1024) return html`<p class="empty">${t('space.empty')}</p>`;
    return html`
      <p class="summary">
        ${t('space.total')}<strong>${formatSize(u.totalBytes)}</strong>
      </p>
      <p class="note">
        ${t(u.versions === 1 ? 'space.versionsOne' : 'space.versionsMany', { n: formatCount(u.versions) })}
        ${t(u.fileCount === 1 ? 'space.filesOne' : 'space.filesMany', { n: formatCount(u.fileCount) })}.
        ${t('space.note', { n: u.keep })}
      </p>
      <div class="list">
        <table>
          <thead>
            <tr>
              <th>${t('space.colFile')}</th>
              <th class="num">${t('space.colVersions')}</th>
              <th class="num">${t('space.colSize')}</th>
              <th class="date">${t('space.colNewest')}</th>
            </tr>
          </thead>
          <tbody>
            ${u.files.map(
              (f) => html`<tr>
                <td class="path">
                  ${f.path ?? t('space.unknown')}${f.path !== null && !f.exists
                    ? html`<span class="tag">${t('space.deleted')}</span>`
                    : nothing}
                </td>
                <td class="num">${formatCount(f.versions)}</td>
                <td class="num">${formatSize(f.bytes)}</td>
                <td class="date">${formatVersionDate(f.newest)}</td>
              </tr>`,
            )}
          </tbody>
        </table>
        ${u.fileCount > u.files.length
          ? html`<div class="more">${t('space.more', { n: formatCount(u.fileCount - u.files.length) })}</div>`
          : nothing}
      </div>
    `;
  }

  override render() {
    return html`<dialog aria-labelledby="space-title" @click=${(e: Event) => e.target === e.currentTarget && this.close()}>
      <h2 id="space-title">${icon(icons.storage, 20)} ${t('space.title')}</h2>
      ${this.error
        ? html`<p class="empty">${this.error}</p>`
        : this.usage
          ? this.renderUsage(this.usage)
          : html`<p class="empty">${t('insert.loading')}</p>`}
      <div class="actions">
        <button class="btn" @click=${() => this.close()}>${t('common.close')}</button>
      </div>
    </dialog>`;
  }
}

customElements.define('editha-history-space', EdithaHistorySpace);
