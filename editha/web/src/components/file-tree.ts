import { LitElement, css, html, nothing } from 'lit';
import { api, ApiError, errorText } from '../api/client.js';
import type { Entry } from '../api/types.js';
import { dirname, isWithin } from '../state/paths.js';
import { fileIcon, icon, icons } from '../ui/icons.js';
import { sharedStyles } from '../ui/shared-styles.js';
import { clearable } from '../ui/clearable.js';
import { t } from '../i18n/index.js';
import { MAC, shortcutLabel } from '../state/keys.js';

export interface TreeSelection {
  path: string;
  type: 'file' | 'directory' | 'other';
  readOnly: boolean;
}

interface Row {
  entry: Entry;
  depth: number;
}

/**
 * Albero di /config (FS-1): cartelle caricate quando si aprono, scorrimento
 * indipendente dall'editor (FEP #4), selezione usata come destinazione di
 * "Nuovo file" e "Nuova cartella" (FEP #11).
 */
export class EdithaFileTree extends LitElement {
  static override properties = {
    activePath: { type: String },
    showSystem: { type: Boolean },
    dirs: { state: true },
    expanded: { state: true },
    selected: { state: true },
    filter: { state: true },
    rootError: { state: true },
    dropTarget: { state: true },
  };

  declare activePath: string | null;
  /** Se false, le voci in sola lettura (cartelle di sistema) non compaiono (SEC-8). */
  declare showSystem: boolean;
  declare dirs: Map<string, Entry[]>;
  declare expanded: Set<string>;
  declare selected: TreeSelection | null;
  declare filter: string;
  declare rootError: string | null;
  /** Cartella su cui si stanno trascinando file dal PC (null: nessun trascinamento). */
  declare dropTarget: string | null;

  constructor() {
    super();
    this.activePath = null;
    this.showSystem = false;
    this.dirs = new Map();
    this.expanded = new Set();
    this.selected = null;
    this.filter = '';
    this.rootError = null;
    this.dropTarget = null;
  }

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        background: var(--surface-2);
      }
      :host([hidden]) {
        display: none;
      }
      header {
        display: flex;
        /* Barra stretta: i pulsanti vanno a capo invece di uscire a sinistra, irraggiungibili. */
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: 2px;
        min-height: 40px;
        padding: 4px 6px 4px 14px;
        flex: none;
      }
      .filter {
        position: relative;
        padding: 0 10px 8px;
        flex: none;
      }
      .filter > svg {
        position: absolute;
        left: 20px;
        top: 8px;
        color: var(--text-faint);
        pointer-events: none;
      }
      .filter .input {
        height: 32px;
        padding-left: 32px;
        font-size: 13px;
        background: var(--surface);
      }
      .list {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 2px 6px 16px;
        outline: none;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 4px;
        height: 28px;
        padding-right: 8px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        white-space: nowrap;
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
        font-size: 13px;
        color: var(--text);
      }
      .row:hover {
        background: var(--hover);
      }
      .row.selected {
        background: var(--accent-soft);
      }
      .list:focus-visible .row.selected {
        outline: 1px solid var(--accent);
        outline-offset: -1px;
      }
      .row.active .name {
        color: var(--accent);
        font-weight: 600;
      }
      .row.unusable {
        opacity: 0.55;
        cursor: default;
      }
      .chevron {
        display: inline-flex;
        width: 16px;
        flex: none;
        color: var(--text-faint);
      }
      .type-icon {
        display: inline-flex;
        flex: none;
      }
      .folder {
        color: #d6a23a;
      }
      .name {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .badge {
        display: inline-flex;
        color: var(--text-faint);
        margin-left: 2px;
        flex: none;
      }
      .row.drop,
      .list.drop-root {
        background: var(--accent-soft);
        outline: 2px dashed var(--accent);
        outline-offset: -2px;
      }
      .drop-hint {
        padding: 6px 12px;
        font-size: 12px;
        color: var(--accent);
      }
      .empty,
      .error {
        padding: 6px 12px;
        font-size: 12px;
        color: var(--text-faint);
        font-style: italic;
      }
      .error {
        color: var(--danger);
        font-style: normal;
      }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load('');
  }

  /** Ricarica una cartella se è già stata caricata (dopo crea, rinomina, elimina). */
  async refresh(dir: string): Promise<void> {
    if (dir === '' || this.dirs.has(dir)) await this.load(dir);
    this.changed(dir);
  }

  async refreshAll(): Promise<void> {
    const dirs = ['', ...[...this.expanded].filter((d) => this.dirs.has(d))];
    await Promise.all(dirs.map((d) => this.load(d)));
    this.changed(null);
  }

  /** Il contenuto di `dir` (null: di tutte) può essere cambiato: la galleria si ricarica (FS-11). */
  private changed(dir: string | null): void {
    this.dispatchEvent(new CustomEvent('dir-changed', { detail: { dir }, bubbles: true, composed: true }));
  }

  collapseAll(): void {
    this.expanded = new Set();
  }

  getSelection(): TreeSelection | null {
    return this.selected;
  }

  /** Apre le cartelle che contengono `path` e lo seleziona. */
  /** Mostra e seleziona una voce; `open` apre anche la cartella. false se la voce non esiste. */
  async reveal(path: string, type: TreeSelection['type'] = 'file', open = false): Promise<boolean> {
    const parts = path.split('/');
    // Cartelle da aprire: si aggiungono alla fine all'insieme di quel momento, così non si perde
    // una cartella aperta o chiusa mentre si aspettava il server.
    const toOpen: string[] = [];
    let dir = '';
    for (const part of parts.slice(0, -1)) {
      dir = dir ? `${dir}/${part}` : part;
      toOpen.push(dir);
      if (!this.dirs.has(dir)) await this.load(dir);
    }
    const entry = this.dirs.get(dirname(path))?.find((e) => e.path === path);
    if (open && entry?.type === 'directory') {
      toOpen.push(path);
      if (!this.dirs.has(path)) await this.load(path);
    }
    this.expanded = new Set([...this.expanded, ...toOpen]);
    this.selected = { path, type: entry?.type ?? type, readOnly: entry?.readOnly ?? false };
    await this.updateComplete;
    this.renderRoot.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' });
    return !!entry;
  }

  /** Dimentica le cartelle eliminate o rinominate. */
  forget(path: string): void {
    const dirs = new Map(this.dirs);
    for (const key of dirs.keys()) if (key !== '' && isWithin(key, path)) dirs.delete(key);
    this.dirs = dirs;
    this.expanded = new Set([...this.expanded].filter((d) => !isWithin(d, path)));
    if (this.selected && isWithin(this.selected.path, path)) this.selected = null;
  }

  private async load(dir: string): Promise<void> {
    try {
      const res = await api.tree(dir);
      const dirs = new Map(this.dirs);
      dirs.set(dir, res.entries);
      this.dirs = dirs;
      if (dir === '') this.rootError = null;
    } catch (err) {
      if (dir === '') this.rootError = err instanceof ApiError ? errorText(err) : t('tree.loadError');
      else if (err instanceof ApiError && err.code === 'not_found') this.forget(dir);
    }
  }

  private async toggle(entry: Entry): Promise<void> {
    if (this.expanded.has(entry.path)) {
      const expanded = new Set(this.expanded);
      expanded.delete(entry.path);
      this.expanded = expanded;
      return;
    }
    if (!this.dirs.has(entry.path)) await this.load(entry.path);
    // Dopo l'attesa: l'insieme di adesso (un'altra cartella aperta nel frattempo resta aperta).
    this.expanded = new Set(this.expanded).add(entry.path);
  }

  /** Se il contenuto della cartella è già stato letto vale quello (più recente), altrimenti l'indicazione del server. */
  private hasChildren(entry: Entry): boolean {
    const loaded = this.dirs.get(entry.path);
    return loaded ? loaded.length > 0 : !entry.empty;
  }

  private onRowClick(entry: Entry): void {
    if (Date.now() - this.longPressAt < 800) return;
    this.selected = { path: entry.path, type: entry.type, readOnly: entry.readOnly };
    if (entry.type === 'directory') void this.toggle(entry);
    else if (entry.type === 'file') this.emit('file-open', { path: entry.path });
  }

  // Pressione prolungata su touch: Safari su iPhone non genera il menu contestuale.
  private pressTimer: ReturnType<typeof setTimeout> | undefined;
  private pressOrigin: { x: number; y: number } | null = null;
  private longPressAt = 0;

  private onPointerDown(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    const row = e
      .composedPath()
      .find((n) => n instanceof HTMLElement && n.classList.contains('row')) as HTMLElement | undefined;
    const entry = row ? (this.findEntry(row.dataset.path ?? '') ?? null) : null;
    if (row && !entry) return;
    const x = e.clientX;
    const y = e.clientY;
    this.cancelPress();
    this.pressOrigin = { x, y };
    this.pressTimer = setTimeout(() => {
      this.pressOrigin = null;
      this.longPressAt = Date.now();
      if (entry) this.selected = { path: entry.path, type: entry.type, readOnly: entry.readOnly };
      this.emit('tree-context', { entry, x, y });
    }, 500);
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.pressOrigin) return;
    if (Math.hypot(e.clientX - this.pressOrigin.x, e.clientY - this.pressOrigin.y) > 10) this.cancelPress();
  }

  private cancelPress(): void {
    clearTimeout(this.pressTimer);
    this.pressOrigin = null;
  }

  private onRowContext(e: MouseEvent, entry: Entry | null): void {
    e.preventDefault();
    e.stopPropagation();
    // Su Android la pressione prolungata genera anche questo evento: il menu è già aperto.
    this.cancelPress();
    if (Date.now() - this.longPressAt < 800) return;
    if (entry) this.selected = { path: entry.path, type: entry.type, readOnly: entry.readOnly };
    this.emit('tree-context', { entry, x: e.clientX, y: e.clientY });
  }

  private findEntry(path: string): Entry | undefined {
    return this.dirs.get(dirname(path))?.find((e) => e.path === path);
  }

  /** Cartella di destinazione per i file trascinati sopra un elemento dell'albero. */
  private dropDir(e: DragEvent): string {
    const row = (e.composedPath().find((n) => n instanceof HTMLElement && n.classList.contains('row')) ??
      null) as HTMLElement | null;
    const path = row?.dataset.path;
    if (!path) return '';
    const entry = this.findEntry(path);
    return entry?.type === 'directory' ? path : dirname(path);
  }

  private onDragOver(e: DragEvent): void {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    this.dropTarget = this.dropDir(e);
  }

  private onDragLeave(e: DragEvent): void {
    const to = e.relatedTarget as Node | null;
    if (!to || !(e.currentTarget as HTMLElement).contains(to)) this.dropTarget = null;
  }

  private onDrop(e: DragEvent): void {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    const dir = this.dropDir(e);
    this.dropTarget = null;
    this.emit('files-drop', { dir, files: [...e.dataTransfer.files] });
  }

  private emit(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  /** Corrispondenza del filtro: il nome o, per le cartelle, un discendente già caricato. */
  private entryMatches(entry: Entry, needle: string): boolean {
    if (entry.name.toLowerCase().includes(needle)) return true;
    if (entry.type !== 'directory') return false;
    return (this.dirs.get(entry.path) ?? []).some((child) => this.entryMatches(child, needle));
  }

  private rows(): Row[] {
    const out: Row[] = [];
    const needle = this.filter.trim().toLowerCase();
    const walk = (dir: string, depth: number) => {
      for (const entry of this.dirs.get(dir) ?? []) {
        if (!this.showSystem && entry.readOnly) continue;
        if (needle && !this.entryMatches(entry, needle)) continue;
        out.push({ entry, depth });
        const open = needle ? this.dirs.has(entry.path) : this.expanded.has(entry.path);
        if (entry.type === 'directory' && open) walk(entry.path, depth + 1);
      }
    };
    walk('', 0);
    return out;
  }

  private onListKey(e: KeyboardEvent, rows: Row[]): void {
    const i = rows.findIndex((r) => r.entry.path === this.selected?.path);
    const current = rows[i]?.entry;
    const select = (entry: Entry | undefined) => {
      if (!entry) return;
      this.selected = { path: entry.path, type: entry.type, readOnly: entry.readOnly };
      void this.updateComplete.then(() =>
        this.renderRoot.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' }),
      );
    };
    switch (e.key) {
      case 'ArrowDown':
        select(rows[Math.min(i + 1, rows.length - 1)]?.entry ?? rows[0]?.entry);
        break;
      case 'ArrowUp':
        select(rows[Math.max(i - 1, 0)]?.entry);
        break;
      case 'ArrowRight':
        if (current?.type === 'directory' && !this.expanded.has(current.path)) void this.toggle(current);
        break;
      case 'ArrowLeft':
        if (current?.type === 'directory' && this.expanded.has(current.path)) void this.toggle(current);
        else if (current) select(rows.find((r) => r.entry.path === dirname(current.path))?.entry);
        break;
      case 'Enter':
        if (current) this.onRowClick(current);
        break;
      case 'F2':
        if (current) this.emit('tree-action', { action: 'rename' });
        break;
      case 'Delete':
        if (current) this.emit('tree-action', { action: 'delete' });
        break;
      // Sul Mac il tasto "delete" manda Backspace (fn+delete manda Delete).
      case 'Backspace':
        if (!MAC) return;
        if (current) this.emit('tree-action', { action: 'delete' });
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  private renderRow({ entry, depth }: Row) {
    const isDir = entry.type === 'directory';
    const open = isDir && (this.filter.trim() ? this.dirs.has(entry.path) : this.expanded.has(entry.path));
    const fi = fileIcon(entry.name);
    const classes = [
      'row',
      this.selected?.path === entry.path ? 'selected' : '',
      this.dropTarget !== null && this.dropTarget !== '' && this.dropTarget === entry.path ? 'drop' : '',
      this.activePath === entry.path ? 'active' : '',
      entry.type === 'other' ? 'unusable' : '',
    ].join(' ');
    return html`<div
      class=${classes}
      role="treeitem"
      aria-expanded=${isDir ? String(open) : nothing}
      aria-selected=${this.selected?.path === entry.path}
      data-path=${entry.path}
      title=${entry.type === 'other' ? t('tree.unusableLink') : entry.path}
      style="padding-left:${8 + depth * 14}px"
      @click=${() => entry.type !== 'other' && this.onRowClick(entry)}
      @contextmenu=${(e: MouseEvent) => this.onRowContext(e, entry)}
    >
      <span class="chevron">${isDir && (open || this.hasChildren(entry)) ? icon(open ? icons.chevronDown : icons.chevronRight, 16) : nothing}</span>
      <span class="type-icon ${isDir ? 'folder' : ''}" style=${isDir ? '' : `color:${fi.color}`}>
        ${icon(isDir ? (open ? icons.folderOpen : icons.folder) : fi.path, 17)}
      </span>
      <span class="name">${entry.name}</span>
      ${entry.symlink ? html`<span class="badge" title=${t('tree.link')}>${icon(icons.link, 13)}</span>` : nothing}
      ${entry.readOnly && entry.type !== 'other'
        ? html`<span class="badge" title=${t('common.readOnly')}>${icon(icons.lock, 12)}</span>`
        : nothing}
    </div>`;
  }

  override render() {
    const rows = this.rows();
    const loaded = this.dirs.has('');
    return html`
      <header role="toolbar" aria-label=${t('tree.title')}>
        <button class="icon-btn small" title=${shortcutLabel(t('toolbar.searchAll'))} @click=${() => this.emit('tree-action', { action: 'search' })}>
          ${icon(icons.search, 17)}
        </button>
        <button class="icon-btn small" title=${t('tree.git')} data-action="git" @click=${() => this.emit('tree-action', { action: 'git' })}>
          ${icon(icons.git, 17)}
        </button>
        <button class="icon-btn small" title=${t('tree.newFile')} @click=${() => this.emit('tree-action', { action: 'new-file' })}>
          ${icon(icons.fileNew, 17)}
        </button>
        <button
          class="icon-btn small"
          title=${t('tree.newFolder')}
          @click=${() => this.emit('tree-action', { action: 'new-folder' })}
        >
          ${icon(icons.folderNew, 17)}
        </button>
        <button
          class="icon-btn small ${this.showSystem ? 'on' : ''}"
          title=${this.showSystem ? t('tree.hideSystem') : t('tree.showSystem')}
          aria-pressed=${String(this.showSystem)}
          data-action="toggle-system"
          @click=${() => this.emit('tree-action', { action: 'toggle-system' })}
        >
          ${icon(this.showSystem ? icons.show : icons.hide, 17)}
        </button>
        <button
          class="icon-btn small"
          title=${t('tree.upload')}
          data-action="upload"
          @click=${() => this.emit('tree-action', { action: 'upload' })}
        >
          ${icon(icons.upload, 17)}
        </button>
        <button class="icon-btn small" title=${t('tree.refresh')} @click=${() => void this.refreshAll()}>
          ${icon(icons.refresh, 17)}
        </button>
        <button class="icon-btn small" title=${t('tree.collapse')} @click=${() => this.collapseAll()}>
          ${icon(icons.collapse, 17)}
        </button>
      </header>
      <div class="filter">
        ${icon(icons.search, 16)}
        ${clearable(
          html`<input
            class="input"
            placeholder=${t('tree.filter')}
            spellcheck="false"
            .value=${this.filter}
            @input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === 'Escape') this.filter = '';
            }}
          />`,
          this.filter,
          () => (this.filter = ''),
        )}
      </div>
      <div
        class="list ${this.dropTarget === '' ? 'drop-root' : ''}"
        role="tree"
        tabindex="0"
        @keydown=${(e: KeyboardEvent) => this.onListKey(e, rows)}
        @contextmenu=${(e: MouseEvent) => this.onRowContext(e, null)}
        @pointerdown=${this.onPointerDown}
        @pointermove=${this.onPointerMove}
        @pointerup=${this.cancelPress}
        @pointercancel=${this.cancelPress}
        @dragover=${this.onDragOver}
        @dragleave=${this.onDragLeave}
        @drop=${this.onDrop}
        @click=${(e: MouseEvent) => {
          if (e.target === e.currentTarget) this.selected = null;
        }}
      >
        ${this.dropTarget !== null
          ? html`<div class="drop-hint">
              ${t('tree.dropHere', { where: this.dropTarget ? `/config/${this.dropTarget}` : '/config' })}
            </div>`
          : nothing}
        ${this.rootError ? html`<div class="error">${this.rootError}</div>` : nothing}
        ${loaded && rows.length === 0
          ? html`<div class="empty">${this.filter ? t('tree.noMatch') : t('tree.empty')}</div>`
          : nothing}
        ${rows.map((r) => this.renderRow(r))}
      </div>
    `;
  }
}

customElements.define('editha-file-tree', EdithaFileTree);
