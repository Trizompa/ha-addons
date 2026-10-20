import { LitElement, css, html, nothing } from 'lit';
import { api, errorText, type HistoryUsageInfo, type PruneInfo } from '../api/client.js';
import { t } from '../i18n/index.js';
import { icon, icons } from '../ui/icons.js';
import { sharedStyles } from '../ui/shared-styles.js';
import { formatCount, formatSize, formatVersionDate } from './history-panel.js';

/** Oggi nel fuso del browser, come lo vuole un campo data (AAAA-MM-GG). */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Frase con N versioni di M file, al singolare quando serve: `prefix` + "Versions"/"Files" One/Many.
 * Il segnaposto {size} resta da sostituire.
 */
function versionsOf(versions: number, files: number, key: 'clean.previewText' | 'clean.done'): string {
  return t(versions === 1 ? `${key}One` : key, {
    versions: t(versions === 1 ? 'clean.versionOne' : 'clean.versionMany', { n: formatCount(versions) }),
    files: t(files === 1 ? 'clean.fileOne' : 'clean.fileMany', { n: formatCount(files) }),
    size: '{size}',
  });
}

/**
 * BK-7: spazio occupato dalla cronologia, in tutto e file per file. Le copie stanno nella
 * cartella dei dati di Editha: qui si guarda soltanto, i file di /config non si toccano.
 */
export class EdithaHistorySpace extends LitElement {
  static override properties = {
    usage: { state: true },
    error: { state: true },
    period: { state: true },
    customDate: { state: true },
    preview: { state: true },
    confirming: { state: true },
    confirmWord: { state: true },
    busy: { state: true },
    result: { state: true },
  };

  declare usage: HistoryUsageInfo | null;
  declare error: string | null;
  /** Giorni della soglia, 'date' per una data scelta, 'all' per tutta la cronologia. */
  declare period: string;
  declare customDate: string;
  /** Anteprima per la soglia `previewBefore`. */
  declare preview: PruneInfo | null;
  declare confirming: boolean;
  /** Parola da scrivere per confermare la cancellazione completa. */
  declare confirmWord: string;
  declare busy: boolean;
  /** Messaggio dopo l'eliminazione (o di errore). */
  declare result: { text: string; ok: boolean } | null;
  /** Soglia dell'anteprima: l'eliminazione usa esattamente questa, non una ricalcolata. */
  private previewBefore: string | null = null;
  /** L'anteprima è della cancellazione completa (conferma forte, avanzi compresi). */
  private previewAll = false;

  constructor() {
    super();
    this.usage = null;
    this.error = null;
    this.period = '30';
    this.customDate = '';
    this.preview = null;
    this.confirming = false;
    this.confirmWord = '';
    this.busy = false;
    this.result = null;
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
      .clean {
        margin-top: 14px;
        padding-top: 12px;
        border-top: 1px solid var(--border);
        font-size: 13px;
      }
      .clean h3 {
        margin: 0 0 8px;
        font-size: 14px;
      }
      .clean .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }
      .clean select,
      .clean input {
        min-height: 32px;
      }
      .clean p {
        margin: 10px 0 0;
        line-height: 1.5;
      }
      .clean ul {
        margin: 6px 0 0;
        padding-left: 18px;
        color: var(--text-muted);
        font-size: 12px;
      }
      .warn {
        color: var(--danger, #c62828);
      }
      .ok {
        color: var(--success, #2e7d32);
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
    this.resetClean();
    this.result = null;
    await this.open();
  }

  private resetClean(): void {
    this.preview = null;
    this.previewBefore = null;
    this.previewAll = false;
    this.confirming = false;
    this.confirmWord = '';
  }

  private get dialog(): HTMLDialogElement {
    return this.renderRoot.querySelector('dialog') as HTMLDialogElement;
  }

  private async open(): Promise<void> {
    const token = ++this.loadToken;
    this.usage = null;
    this.error = null;
    await this.updateComplete;
    if (!this.dialog.open) this.dialog.showModal();
    await this.loadUsage(token);
  }

  /** Ricarica i numeri lasciando visibile il contenuto attuale (il focus resta nella finestra). */
  private async loadUsage(token = ++this.loadToken): Promise<void> {
    try {
      const usage = await api.historyUsage();
      if (token === this.loadToken) this.usage = usage;
    } catch (err) {
      if (token === this.loadToken) this.error = errorText(err);
    }
  }

  /** Il focus non deve finire fuori dalla finestra (su un pulsante appena disattivato o rimosso). */
  private async keepFocus(): Promise<void> {
    await this.updateComplete;
    if (!this.dialog.open) return;
    const active = this.renderRoot instanceof ShadowRoot ? this.renderRoot.activeElement : null;
    if (!active || (active as HTMLButtonElement).disabled) {
      this.dialog.tabIndex = -1;
      this.dialog.focus();
    }
  }

  /**
   * Soglia scelta: N giorni (contati dal server, con il suo orologio), l'inizio del giorno scelto
   * o tutto (fino ad ora, sempre secondo il server).
   */
  private threshold(): { olderThanDays: number } | { before: string } | { all: true } | null {
    if (this.period === 'all') return { all: true };
    if (this.period !== 'date') return { olderThanDays: Number(this.period) };
    if (!this.customDate || this.customDate > todayLocal()) return null;
    const d = new Date(`${this.customDate}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : { before: d.toISOString() };
  }

  private async runPreview(): Promise<void> {
    const before = this.threshold();
    if (!before) return;
    this.busy = true;
    this.result = null;
    this.confirming = false;
    try {
      this.preview = await api.pruneHistory(before, true);
      // La cancellazione userà esattamente questa soglia, calcolata dal server.
      this.previewBefore = this.preview.before;
      this.previewAll = this.period === 'all';
    } catch (err) {
      this.result = { text: errorText(err), ok: false };
    } finally {
      this.busy = false;
    }
    void this.keepFocus();
  }

  private async runPrune(): Promise<void> {
    const before = this.previewBefore;
    if (!before) return;
    this.busy = true;
    try {
      const done = await api.pruneHistory(this.previewAll ? { before, all: true } : { before }, false);
      const text =
        (done.versions > 0
          ? versionsOf(done.versions, done.files.length, 'clean.done')
          : done.bytes > 0
            ? t('clean.doneLeftovers')
            : t(this.previewAll ? 'clean.nothingAll' : 'clean.nothing')) +
        (done.failed.length ? ' ' + (done.failed.length === 1 ? t('clean.failedOne') : t('clean.failed', { n: formatCount(done.failed.length) })) : '');
      this.result = { ok: done.failed.length === 0, text: text.replace('{size}', formatSize(done.bytes)) };
      this.dispatchEvent(new CustomEvent('history-pruned', { bubbles: true, composed: true }));
    } catch (err) {
      this.result = { text: errorText(err), ok: false };
    } finally {
      this.busy = false;
      this.resetClean();
    }
    // Chiusa nel frattempo: resta chiusa.
    if (this.dialog.open) {
      await this.loadUsage();
      void this.keepFocus();
    }
  }

  private renderClean() {
    const p = this.preview;
    return html`<section class="clean">
      <h3>${t('clean.title')}</h3>
      <div class="row">
        <label for="clean-period">${t('clean.which')}</label>
        <select
          id="clean-period"
          .value=${this.period}
          ?disabled=${this.busy}
          @change=${(e: Event) => {
            this.period = (e.target as HTMLSelectElement).value;
            this.resetClean();
          }}
        >
          ${['7', '30', '90', '365'].map(
            (d) => html`<option value=${d} ?selected=${this.period === d}>${t(`clean.days${d}` as 'clean.days7')}</option>`,
          )}
          <option value="date" ?selected=${this.period === 'date'}>${t('clean.beforeDate')}</option>
          <option value="all" ?selected=${this.period === 'all'}>${t('clean.all')}</option>
        </select>
        ${this.period === 'date'
          ? html`<input
              type="date"
              aria-label=${t('clean.dateLabel')}
              .value=${this.customDate}
              max=${todayLocal()}
              ?disabled=${this.busy}
              @change=${(e: Event) => {
                this.customDate = (e.target as HTMLInputElement).value;
                this.resetClean();
              }}
            />`
          : nothing}
        <button class="btn" data-action="clean-preview" ?disabled=${this.busy || !this.threshold()} @click=${() => void this.runPreview()}>
          ${t('clean.preview')}
        </button>
      </div>
      ${p
        ? p.versions === 0 && p.bytes === 0
          ? html`<p>${this.previewAll ? t('clean.nothingAll') : t('clean.nothing')}</p>`
          : html`<p>
                ${(p.versions === 0
                  ? t('clean.onlyLeftovers')
                  : versionsOf(p.versions, p.files.length, 'clean.previewText')
                ).replace('{size}', formatSize(p.bytes))}
                ${p.versions > 0 && p.leftovers.bytes > 0
                  ? t('clean.leftovers', { size: formatSize(p.leftovers.bytes) })
                  : nothing}
                ${!this.previewAll && p.files.some((f) => f.emptied)
                  ? t('clean.emptied', { n: formatCount(p.files.filter((f) => f.emptied).length) })
                  : nothing}
              </p>
              <ul>
                ${p.files.slice(0, 8).map(
                  (f) => html`<li>${f.path ?? t('space.unknown')}: ${t(
                      f.versions === 1 ? 'space.versionsOne' : 'space.versionsMany',
                      { n: formatCount(f.versions) },
                    )}, ${formatSize(f.bytes)}</li>`,
                )}
                ${p.files.length > 8 ? html`<li>${t('space.more', { n: formatCount(p.files.length - 8) })}</li>` : nothing}
              </ul>
              ${this.confirming
                ? html`<p class="warn" id="clean-warning">${this.previewAll ? t('clean.confirmAll') : t('clean.confirm')}</p>
                    ${this.previewAll
                      ? html`<div class="row">
                          <label for="clean-word">${t('clean.typeWord', { word: t('clean.word') })}</label>
                          <input
                            id="clean-word"
                            aria-describedby="clean-warning"
                            autocomplete="off"
                            autocapitalize="characters"
                            spellcheck="false"
                            .value=${this.confirmWord}
                            ?disabled=${this.busy}
                            @input=${(e: Event) => (this.confirmWord = (e.target as HTMLInputElement).value)}
                            @keydown=${(e: KeyboardEvent) => {
                              if (e.key === 'Enter' && !e.isComposing && !this.busy && this.confirmWord.trim() === t('clean.word')) void this.runPrune();
                            }}
                          />
                        </div>`
                      : nothing}
                    <div class="row">
                      <button class="btn" ?disabled=${this.busy} @click=${() => {
                        this.confirming = false;
                        void this.keepFocus();
                      }}>${t('common.cancel')}</button>
                      <button class="btn danger" data-action="clean-confirm"
                        ?disabled=${this.busy || (this.previewAll && this.confirmWord.trim() !== t('clean.word'))}
                        @click=${() => void this.runPrune()}>
                        ${t('clean.confirmButton')}
                      </button>
                    </div>`
                : html`<div class="row" style="margin-top: 8px">
                    <button class="btn danger" data-action="clean-delete" ?disabled=${this.busy} @click=${async () => {
                      this.confirming = true;
                      await this.updateComplete;
                      // Cancellazione completa: si scrive subito la parola di conferma.
                      const word = this.renderRoot.querySelector<HTMLInputElement>('#clean-word');
                      if (word) word.focus();
                      else void this.keepFocus();
                    }}>
                      ${this.previewAll
                        ? t('clean.deleteAll')
                        : p.versions === 1
                          ? t('clean.deleteOne')
                          : t('clean.delete', { n: formatCount(p.versions) })}
                    </button>
                  </div>`}`
        : nothing}
      ${this.result ? html`<p class=${this.result.ok ? 'ok' : 'warn'} role="status">${this.result.text}</p>` : nothing}
    </section>`;
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
      ${this.usage && (this.usage.versions > 0 || this.result) ? this.renderClean() : nothing}
      <div class="actions">
        <button class="btn" @click=${() => this.close()}>${t('common.close')}</button>
      </div>
    </dialog>`;
  }
}

customElements.define('editha-history-space', EdithaHistorySpace);
