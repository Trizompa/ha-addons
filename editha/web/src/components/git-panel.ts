import { LitElement, css, html, nothing } from 'lit';
import { api, errorText, type GitChange, type GitInfo } from '../api/client.js';
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
    changes: { state: true },
    truncated: { state: true },
    merging: { state: true },
    unchecked: { state: true },
    message: { state: true },
  };

  declare info: GitInfo | null;
  declare error: string | null;
  declare busy: boolean;
  /** GIT-2: file cambiati dall'ultimo commit (null finché non sono letti). */
  declare changes: GitChange[] | null;
  declare truncated: boolean;
  /** Unione (merge) in corso: i commit si fanno da un terminale. */
  declare merging: boolean;
  /** File tolti dal commit con la casella: restano tolti anche dopo un aggiornamento. */
  declare unchecked: Set<string>;
  declare message: string;
  /** Caricamento in corso: una risposta vecchia non sostituisce quella nuova. */
  private loadToken = 0;

  constructor() {
    super();
    this.info = null;
    this.error = null;
    this.busy = false;
    this.changes = null;
    this.truncated = false;
    this.merging = false;
    this.unchecked = new Set();
    this.message = '';
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
      .small {
        font-size: 12px;
      }
      .changes-head {
        margin: 4px 0 4px;
        font-weight: 600;
      }
      .changes-head label {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      ul.changes {
        list-style: none;
        margin: 0 0 8px;
        padding: 0;
        color: var(--text);
      }
      ul.changes li {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 26px;
      }
      ul.changes li.blocked {
        color: var(--text-muted);
      }
      .badge {
        flex: none;
        width: 18px;
        text-align: center;
        font-size: 11px;
        font-weight: 700;
        border-radius: 4px;
      }
      .badge.modified {
        color: var(--warning);
      }
      .badge.added {
        color: var(--success);
      }
      .badge.deleted,
      .badge.conflict {
        color: var(--danger);
      }
      .path {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        padding: 0;
        border: none;
        background: none;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      button.path:hover {
        text-decoration: underline;
      }
      .path.deleted {
        text-decoration: line-through;
        cursor: default;
      }
      .lock {
        flex: none;
        display: inline-flex;
      }
      .message {
        width: 100%;
        margin: 4px 0 8px;
        resize: vertical;
        font: inherit;
      }
      .commit {
        width: 100%;
        justify-content: center;
        margin-bottom: 12px;
      }
    `,
  ];

  /** Rilegge lo stato del repository (all'apertura del pannello e dopo un'operazione). */
  /** `auto`: aggiornamento automatico (dopo un salvataggio o un'operazione sui file). */
  async load(auto = false): Promise<void> {
    const token = ++this.loadToken;
    this.error = null;
    try {
      const info = await api.git.info();
      if (token !== this.loadToken) return;
      this.info = info;
      if (info.available && info.repo === 'ready') {
        const status = await api.git.status();
        if (token !== this.loadToken) return;
        // File comparsi con un aggiornamento automatico: non spuntati, così non entrano a sorpresa.
        if (auto && this.changes) {
          const seen = new Set(this.changes.map((c) => c.path));
          const fresh = status.files.filter((c) => !seen.has(c.path)).map((c) => c.path);
          if (fresh.length > 0) this.unchecked = new Set([...this.unchecked, ...fresh]);
        }
        this.changes = status.files;
        this.truncated = status.truncated;
        this.merging = status.merging;
      } else {
        this.changes = null;
        this.unchecked = new Set();
      }
    } catch (err) {
      if (token === this.loadToken) this.error = errorText(err);
    }
  }

  /** File che si possono mettere in un commit (non i segreti, non quelli in conflitto). */
  private selectable(): GitChange[] {
    return this.merging ? [] : (this.changes ?? []).filter((c) => c.blocked === null);
  }

  private selected(): string[] {
    return this.selectable()
      .filter((c) => !this.unchecked.has(c.path))
      .map((c) => c.path);
  }

  private toggle(path: string, on: boolean): void {
    const next = new Set(this.unchecked);
    if (on) next.delete(path);
    else next.add(path);
    this.unchecked = next;
  }

  private toggleAll(on: boolean): void {
    this.unchecked = on ? new Set() : new Set(this.selectable().map((c) => c.path));
  }

  /** GIT-4: commit dei file scelti con il messaggio scritto. */
  private async commit(): Promise<void> {
    const paths = this.selected();
    const message = this.message.trim();
    if (paths.length === 0 || message === '' || this.busy) return;
    this.busy = true;
    try {
      const res = await api.git.commit(message, paths);
      this.message = '';
      this.unchecked = new Set();
      // Dopo il commit si riparte da zero: i file rimasti tornano tutti spuntati.
      this.changes = null;
      this.emit('git-changed', {
        message: t(res.files === 1 ? 'git.committedOne' : 'git.committedMany', { subject: res.subject, n: res.files }),
        tree: false,
      });
    } catch (err) {
      this.emit('git-error', { message: errorText(err) });
    } finally {
      this.busy = false;
    }
    await this.load();
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
      this.emit('git-changed', { message: res.gitignoreCreated ? t('git.initDone') : t('git.initDoneKept') });
      await this.load();
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
      await this.load();
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
        <div class="label">${t('git.branch')}: ${info.branch ?? t('git.detached')}</div>
        <div class="value">
          ${info.head
            ? html`${info.head.subject}<br /><span class="muted"
                  ><code>${info.head.hash.slice(0, 7)}</code> · ${formatVersionDate(info.head.date)}</span
                >`
            : html`<span class="muted">${t('git.noCommits')}</span>`}
        </div>
      </div>
      ${this.renderChanges()}
      ${info.gitignore
        ? nothing
        : html`<p>${t('git.noGitignore')}</p>
            ${this.renderIgnored()}
            <button class="btn" data-action="git-gitignore" ?disabled=${this.busy} @click=${() => void this.createGitignore()}>
              ${t('git.createGitignore')}
            </button>`}
      <p class="muted small">${t('git.localOnly')}</p>
    `;
  }

  private static readonly BADGE: Record<GitChange['status'], 'git.statusModified' | 'git.statusAdded' | 'git.statusDeleted' | 'git.statusConflict'> = {
    modified: 'git.statusModified',
    added: 'git.statusAdded',
    deleted: 'git.statusDeleted',
    conflict: 'git.statusConflict',
  };

  private static readonly REASON: Record<
    Exclude<GitChange['blocked'], null>,
    'git.secretExcluded' | 'git.sensitiveExcluded' | 'git.filterExcluded' | 'git.conflictExcluded' | 'git.nestedExcluded'
  > = {
    secret: 'git.secretExcluded',
    sensitive: 'git.sensitiveExcluded',
    filter: 'git.filterExcluded',
    conflict: 'git.conflictExcluded',
    nested: 'git.nestedExcluded',
  };

  /** GIT-2 e GIT-4: elenco dei file cambiati con le caselle, messaggio e pulsante Commit. */
  private renderChanges() {
    const changes = this.changes;
    if (!changes) return html`<p class="muted" role="status">${t('insert.loading')}</p>`;
    if (changes.length === 0) return html`<p class="muted">${t('git.clean')}</p>`;
    const selectable = this.selectable();
    const selected = this.selected();
    const allOn = selected.length === selectable.length && selectable.length > 0;
    const someOn = selected.length > 0 && !allOn;
    const canCommit = selected.length > 0 && this.message.trim() !== '' && !this.busy;
    return html`
      <div class="changes-head">
        <label>
          <input
            type="checkbox"
            .checked=${allOn}
            .indeterminate=${someOn}
            ?disabled=${selectable.length === 0 || this.busy}
            @change=${(e: Event) => this.toggleAll((e.target as HTMLInputElement).checked)}
          />
          ${t('git.changes', { n: changes.length })}
        </label>
      </div>
      <ul class="changes">
        ${changes.map((c) => {
          const blocked = c.blocked !== null || this.merging;
          const statusText = t(EdithaGitPanel.BADGE[c.status]);
          return html`<li class=${blocked ? 'blocked' : ''}>
            <input
              type="checkbox"
              data-path=${c.path}
              aria-label=${`${c.path}, ${statusText}${c.blocked ? `, ${t(EdithaGitPanel.REASON[c.blocked])}` : ''}`}
              .checked=${!blocked && !this.unchecked.has(c.path)}
              ?disabled=${blocked || this.busy}
              @change=${(e: Event) => this.toggle(c.path, (e.target as HTMLInputElement).checked)}
            />
            <span class="badge ${c.status}" title=${t(EdithaGitPanel.BADGE[c.status])}>${t(EdithaGitPanel.BADGE[c.status]).slice(0, 1)}</span>
            ${c.status === 'deleted' || c.blocked === 'nested'
              ? html`<span class="path ${c.status === 'deleted' ? 'deleted' : ''}">${c.path}</span>`
              : html`<button class="path" title=${c.path} @click=${() => this.emit('git-open', { path: c.path })}>${c.path}</button>`}
            ${c.blocked && c.blocked !== 'conflict'
              ? html`<span class="lock" title=${t(EdithaGitPanel.REASON[c.blocked])}>${icon(icons.lock, 14)}</span>`
              : nothing}
          </li>`;
        })}
      </ul>
      ${this.truncated ? html`<p class="muted small">${t('git.truncated')}</p>` : nothing}
      ${this.merging ? html`<p class="warn small">${t('git.merging')}</p>` : nothing}
      ${[...new Set(changes.map((c) => c.blocked).filter((b): b is Exclude<GitChange['blocked'], null> => b !== null))].map(
        (b) => html`<p class="muted small">${b === 'conflict' ? nothing : icon(icons.lock, 12)} ${t(EdithaGitPanel.REASON[b])}</p>`,
      )}
      <textarea
        class="input message"
        rows="3"
        aria-label=${t('git.messageLabel')}
        placeholder=${t('git.messagePlaceholder')}
        .value=${this.message}
        ?disabled=${this.busy}
        @input=${(e: Event) => (this.message = (e.target as HTMLTextAreaElement).value)}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void this.commit();
          }
        }}
      ></textarea>
      <button class="btn primary commit" data-action="git-commit" ?disabled=${!canCommit} @click=${() => void this.commit()}>
        ${icon(icons.ok, 16)} ${t(selected.length === 1 ? 'git.commitOne' : 'git.commitMany', { n: selected.length })}
      </button>
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
