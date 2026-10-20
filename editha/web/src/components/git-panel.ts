import { LitElement, css, html, nothing } from 'lit';
import { api, errorText, type GitChange, type GitCommit, type GitInfo } from '../api/client.js';
import { t } from '../i18n/index.js';
import { icon, icons } from '../ui/icons.js';
import { sharedStyles } from '../ui/shared-styles.js';
import { formatVersionDate } from './history-panel.js';

type CommitFiles = Awaited<ReturnType<typeof api.git.commitFiles>>['files'];

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
    showLog: { state: true },
    commits: { state: true },
    logMore: { state: true },
    expanded: { state: true },
    ignoredList: { state: true },
    showIgnored: { state: true },
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
  /** GIT-5: storia dei commit aperta, commit letti finora, se ce ne sono altri. */
  declare showLog: boolean;
  declare commits: GitCommit[] | null;
  declare logMore: boolean;
  /** Commit aperti: i file toccati (o 'loading', o un errore). */
  declare expanded: Map<string, CommitFiles | 'loading' | { error: string }>;
  /** Esclusioni di percorsi precisi nel .gitignore (quelle dell'occhio barrato), da poter annullare. */
  declare ignoredList: { line: string; path: string }[];
  declare showIgnored: boolean;
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
    this.showLog = false;
    this.commits = null;
    this.logMore = false;
    this.expanded = new Map();
    this.ignoredList = [];
    this.showIgnored = false;
  }

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        min-height: 0;
        height: 100%;
        /* Sul telefono il pannello sta sopra l'editor: senza sfondo si vedeva quello che c'è sotto. */
        background: var(--surface);
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
      .path.folder {
        display: flex;
        align-items: center;
        gap: 4px;
        cursor: default;
      }
      .path .count {
        font-size: 12px;
      }
      .legend {
        display: flex;
        flex-direction: column;
        gap: 3px;
        margin: 0 0 10px;
        padding: 6px 10px;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        font-size: 12px;
        color: var(--text-muted);
      }
      /* Una voce per riga: mai a capo. */
      .legend-row {
        display: flex;
        align-items: center;
        gap: 6px;
        line-height: 1.4;
        white-space: nowrap;
        overflow: hidden;
      }
      .legend-row > span:last-child {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* Simbolo a sinistra, testo accanto sulla stessa riga. */
      .legend .sym {
        display: inline-flex;
        flex: none;
      }
      .legend .badge {
        display: inline-block;
        width: auto;
      }
      .legend .tick {
        color: var(--accent);
      }
      ul.changes.ignored li {
        gap: 6px;
      }
      ul.changes.ignored .small-btn {
        margin: 0;
        flex: none;
      }
      .hint {
        margin: 0 0 8px;
        padding: 6px 10px;
        border-radius: var(--radius-sm);
        background: var(--accent-soft);
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
      .section-toggle {
        display: flex;
        align-items: center;
        gap: 4px;
        width: 100%;
        margin: 4px 0 6px;
        padding: 4px 0;
        border: none;
        background: none;
        color: var(--text);
        font: inherit;
        font-weight: 600;
        text-align: left;
        cursor: pointer;
      }
      ul.log {
        list-style: none;
        margin: 0 0 8px;
        padding: 0;
      }
      ul.log > li {
        border-bottom: 1px solid var(--border);
      }
      .commit-row {
        display: flex;
        flex-direction: column;
        gap: 2px;
        width: 100%;
        padding: 6px 4px;
        border: none;
        background: none;
        color: var(--text);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .commit-row:hover {
        background: var(--hover);
      }
      .commit-row .subject {
        overflow-wrap: anywhere;
      }
      .commit-row .meta {
        font-size: 12px;
      }
      ul.changes.files {
        margin: 0 0 6px 8px;
      }
      .small-btn {
        margin-bottom: 12px;
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
          // Anche una cartella nuova che nel frattempo contiene altri file torna senza spunta.
          const seen = new Map(this.changes.map((c) => [c.path, c.folder?.files]));
          const fresh = status.files.filter((c) => !seen.has(c.path) || seen.get(c.path) !== c.folder?.files).map((c) => c.path);
          if (fresh.length > 0) this.unchecked = new Set([...this.unchecked, ...fresh]);
        }
        this.changes = status.files;
        this.truncated = status.truncated;
        this.merging = status.merging;
        this.ignoredList = (await api.git.ignored()).entries;
        // La storia si rilegge solo se è cambiato l'ultimo commit (aperti e pagine restano).
        if (this.showLog && info.head?.hash !== this.logHead) void this.loadLog(true);
      } else {
        this.changes = null;
        this.unchecked = new Set();
      }
    } catch (err) {
      if (token === this.loadToken) this.error = errorText(err);
    }
  }

  /** GIT-5: storia dei commit; `reset` riparte dal più recente (dopo un commit). */
  /** Ultimo commit quando la storia è stata letta; richieste della storia in corso. */
  private logHead: string | undefined;
  private logToken = 0;

  private async loadLog(reset = false): Promise<void> {
    const token = ++this.logToken;
    const skip = reset || !this.commits ? 0 : this.commits.length;
    const head = this.info?.head?.hash;
    try {
      const res = await api.git.log(skip);
      if (token !== this.logToken) return;
      // Pagine successive: senza i commit già in elenco (uno nuovo da un terminale sposta tutto).
      const known = new Set(skip === 0 ? [] : (this.commits ?? []).map((c) => c.hash));
      const added = res.commits.filter((c) => !known.has(c.hash));
      this.commits = skip === 0 ? added : [...(this.commits ?? []), ...added];
      this.logMore = res.more;
      if (skip === 0) {
        this.logHead = head;
        // I commit aperti restano aperti, se ci sono ancora.
        const still = new Set(added.map((c) => c.hash));
        this.expanded = new Map([...this.expanded].filter(([hash]) => still.has(hash)));
      }
    } catch (err) {
      if (token === this.logToken) this.emit('git-error', { message: errorText(err) });
    }
  }

  private async toggleCommit(hash: string): Promise<void> {
    const next = new Map(this.expanded);
    if (next.has(hash)) {
      next.delete(hash);
      this.expanded = next;
      return;
    }
    next.set(hash, 'loading');
    this.expanded = next;
    let value: CommitFiles | { error: string };
    try {
      value = (await api.git.commitFiles(hash)).files;
    } catch (err) {
      value = { error: errorText(err) };
    }
    if (!this.expanded.has(hash)) return;
    this.expanded = new Map(this.expanded).set(hash, value);
  }

  private renderLog() {
    if (!this.info?.head) return nothing;
    return html`
      <button
        class="section-toggle"
        aria-expanded=${String(this.showLog)}
        data-action="git-log"
        @click=${() => {
          this.showLog = !this.showLog;
          if (this.showLog) void this.loadLog(true);
        }}
      >
        ${icon(this.showLog ? icons.chevronDown : icons.chevronRight, 16)} ${t('git.history')}
      </button>
      ${this.showLog
        ? html`${this.commits === null
              ? html`<p class="muted small" role="status">${t('insert.loading')}</p>`
              : this.commits.length === 0
                ? html`<p class="muted small">${t('git.historyEmpty')}</p>`
                : html`<ul class="log">
                    ${this.commits.map((c) => this.renderCommit(c))}
                  </ul>`}
            ${this.logMore
              ? html`<button class="btn small-btn" @click=${() => void this.loadLog()}>${t('git.more')}</button>`
              : nothing}`
        : nothing}
    `;
  }

  private renderCommit(c: GitCommit) {
    const open = this.expanded.get(c.hash);
    return html`<li>
      <button class="commit-row" aria-expanded=${String(open !== undefined)} @click=${() => void this.toggleCommit(c.hash)}>
        <span class="subject">${c.subject}</span>
        <span class="meta muted"><code>${c.hash.slice(0, 7)}</code> · ${formatVersionDate(c.date)}</span>
      </button>
      ${open === undefined
        ? nothing
        : open === 'loading'
          ? html`<p class="muted small" role="status">${t('git.commitFilesLoading')}</p>`
          : 'error' in open
            ? html`<p class="warn small">${open.error}</p>`
            : html`<ul class="changes files">
                ${open.map(
                  (f) => html`<li class=${f.blocked ? 'blocked' : ''}>
                    <span class="badge ${f.status}" title=${t(EdithaGitPanel.BADGE[f.status])}>${t(EdithaGitPanel.BADGE[f.status]).slice(0, 1)}</span>
                    <span class="path" title=${f.path}>${f.path}</span>
                    ${f.blocked
                      ? html`<span class="lock" title=${t('git.commitFilesBlocked')}>${icon(icons.lock, 14)}</span>`
                      : f.status === 'deleted'
                        ? nothing
                        : html`<button
                              class="icon-btn small"
                              data-action="git-rev-diff"
                              title=${t('git.compareRev')}
                              aria-label=${`${t('git.compareRev')}: ${f.path}`}
                              @click=${() => this.emit('git-rev-diff', { path: f.path, rev: c.hash })}
                            >
                              ${icon(icons.compare, 15)}
                            </button>
                            <button
                              class="icon-btn small"
                              data-action="git-restore"
                              title=${t('git.restoreRev')}
                              aria-label=${`${t('git.restoreRev')}: ${f.path}`}
                              @click=${() => this.emit('git-restore', { path: f.path, rev: c.hash, subject: c.subject })}
                            >
                              ${icon(icons.restore, 15)}
                            </button>`}
                  </li>`,
                )}
              </ul>`}
    </li>`;
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

  /** Esclude un file o una cartella nuovi dal repository (una riga nel .gitignore). */
  private async ignore(path: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await api.git.ignore(path);
      this.emit('git-changed', { message: t('git.ignored', { path }) });
    } catch (err) {
      this.emit('git-error', { message: errorText(err) });
    } finally {
      this.busy = false;
    }
    await this.load();
  }

  /** Includi di nuovo: toglie la riga dal .gitignore, il file o la cartella ricompaiono. */
  private async unignore(line: string, shown: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const res = await api.git.unignore(line);
      if (res.stillIgnored) this.emit('git-error', { message: t('git.stillIgnored', { path: shown }) });
      else this.emit('git-changed', { message: t('git.unignored', { path: shown }) });
    } catch (err) {
      this.emit('git-error', { message: errorText(err) });
    } finally {
      this.busy = false;
    }
    await this.load();
  }

  private renderIgnoredList() {
    const list = this.ignoredList;
    if (list.length === 0) return nothing;
    return html`
      <button
        class="section-toggle"
        aria-expanded=${String(this.showIgnored)}
        data-action="git-ignored"
        @click=${() => (this.showIgnored = !this.showIgnored)}
      >
        ${icon(this.showIgnored ? icons.chevronDown : icons.chevronRight, 16)} ${t('git.ignoredList', { n: list.length })}
      </button>
      ${this.showIgnored
        ? html`<p class="muted small">${t('git.ignoredListHint')}</p>
            <ul class="changes ignored">
              ${list.map(
                (e) => html`<li>
                  <span class="path" title=${e.line}>${icon(e.path.endsWith('/') ? icons.folder : icons.file, 14)} ${e.path}</span>
                  <button
                    class="btn small-btn"
                    data-action="git-unignore"
                    ?disabled=${this.busy}
                    @click=${() => void this.unignore(e.line, e.path)}
                  >
                    ${icon(icons.show, 14)} ${t('git.unignore')}
                  </button>
                </li>`,
              )}
            </ul>`
        : nothing}
    `;
  }

  /** Quanti file entrano davvero nel commit (una cartella nuova conta per i file che contiene). */
  private fileCount(paths: string[]): number {
    const byPath = new Map((this.changes ?? []).map((c) => [c.path, c]));
    return paths.reduce((n, p) => n + (byPath.get(p)?.folder?.files ?? 1), 0);
  }

  /** GIT-4: commit dei file scelti con il messaggio scritto. */
  private async commit(): Promise<void> {
    const paths = this.selected();
    const message = this.message.trim();
    if (paths.length === 0 || message === '' || this.busy || this.truncated) return;
    this.busy = true;
    try {
      const folders = Object.fromEntries(
        (this.changes ?? []).filter((c) => c.folder && paths.includes(c.path)).map((c) => [c.path, c.folder!.files]),
      );
      const res = await api.git.commit(message, paths, folders);
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
      ${this.renderIgnoredList()}
      ${this.renderLog()}
      ${info.gitignore
        ? nothing
        : html`<p>${t('git.noGitignore')}</p>
            ${this.renderIgnored()}
            <button class="btn" data-action="git-gitignore" ?disabled=${this.busy} @click=${() => void this.createGitignore()}>
              ${t('git.createGitignore')}
            </button>`}
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
    const canCommit = selected.length > 0 && this.message.trim() !== '' && !this.busy && !this.truncated;
    const count = this.fileCount(selected);
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
      ${!this.info?.head ? html`<p class="hint small">${t('git.firstCommitHint')}</p>` : nothing}
      <div class="legend" role="note" aria-label=${t('git.legend')}>
        <div class="legend-row"><span class="sym tick">${icon(icons.checkbox, 15)}</span><span>${t('git.legendCheck')}</span></div>
        <div class="legend-row">
          <span
            ><span class="badge added">N</span> ${t('git.statusAdded')} · <span class="badge modified">M</span> ${t('git.statusModified')} ·
            <span class="badge deleted">${t('git.statusDeleted').slice(0, 1)}</span> ${t('git.statusDeleted')}</span
          >
        </div>
        <div class="legend-row"><span class="sym">${icon(icons.hide, 15)}</span><span>${t('git.legendEye')}</span></div>
        ${this.info?.head
          ? html`<div class="legend-row"><span class="sym">${icon(icons.compare, 15)}</span><span>${t('git.legendCompare')}</span></div>`
          : nothing}
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
            ${c.folder
              ? html`<span class="path folder" title=${c.path}
                  >${icon(icons.folder, 14)} ${c.path}
                  <span class="muted count"
                    >${t(c.folder.files === 1 ? 'git.folderOne' : 'git.folderMany', { n: c.folder.files })}${c.folder.excluded
                      ? ` · ${t('git.folderExcluded', { n: c.folder.excluded })}`
                      : ''}</span
                  ></span
                >`
              : c.status === 'deleted' || c.blocked === 'nested'
              ? html`<span class="path ${c.status === 'deleted' ? 'deleted' : ''}">${c.path}</span>`
              : html`<button class="path" title=${c.path} @click=${() => this.emit('git-open', { path: c.path })}>${c.path}</button>`}
            ${c.untracked && c.blocked === null && !this.merging
              ? html`<button
                  class="icon-btn small"
                  data-action="git-ignore"
                  title=${t('git.ignore')}
                  aria-label=${`${t('git.ignore')}: ${c.path}`}
                  ?disabled=${this.busy}
                  @click=${() => void this.ignore(c.path)}
                >
                  ${icon(icons.hide, 15)}
                </button>`
              : nothing}
            ${!c.folder && !c.untracked && this.info?.head && (c.blocked === null || c.blocked === 'conflict' || c.blocked === 'filter')
              ? html`<button
                  class="icon-btn small diff"
                  data-action="git-diff"
                  title=${t('git.diff')}
                  aria-label=${`${t('git.diff')}: ${c.path}`}
                  @click=${() => this.emit('git-diff', { path: c.path, deleted: c.status === 'deleted' })}
                >
                  ${icon(icons.compare, 15)}
                </button>`
              : nothing}
            ${c.blocked && c.blocked !== 'conflict'
              ? html`<span class="lock" title=${t(EdithaGitPanel.REASON[c.blocked])}>${icon(icons.lock, 14)}</span>`
              : nothing}
          </li>`;
        })}
      </ul>
      ${this.truncated ? html`<p class="warn small">${t('git.truncated')}</p>` : nothing}
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
        ${icon(icons.ok, 16)} ${t(count === 1 ? 'git.commitOne' : 'git.commitMany', { n: count })}
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
