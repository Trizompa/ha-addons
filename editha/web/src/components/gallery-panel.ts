import { LitElement, css, html, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { api, ApiError, errorText } from '../api/client.js';
import type { Entry } from '../api/types.js';
import { t } from '../i18n/index.js';
import { previewKind } from '../state/preview.js';
import { icon, icons } from '../ui/icons.js';
import { sharedStyles } from '../ui/shared-styles.js';

export type ThumbSize = 's' | 'm' | 'l';

/** Oltre questa dimensione niente miniatura: scaricarla per una griglia sarebbe troppo pesante. */
const MAX_THUMB_BYTES = 5 * 1024 * 1024;

const SIZE_KEY = 'editha.gallerySize';

function savedSize(): ThumbSize {
  try {
    const v = localStorage.getItem(SIZE_KEY);
    return v === 's' || v === 'l' ? v : 'm';
  } catch {
    return 'm';
  }
}

function kb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * FS-11: galleria delle immagini di una cartella (solo quella, non le sottocartelle), al posto
 * dell'editor come l'anteprima. Miniature caricate quando entrano nello schermo, filtro per nome,
 * tre grandezze; un clic apre l'immagine in grande, il tasto destro i soliti comandi del file.
 */
export class EdithaGalleryPanel extends LitElement {
  static override properties = {
    path: { type: String },
    revision: { type: Number },
    entries: { state: true },
    error: { state: true },
    filter: { state: true },
    size: { state: true },
    open: { state: true },
    dims: { state: true },
  };

  declare path: string;
  /** Cambia quando il contenuto della cartella cambia (rinomina, elimina, carica…): si ricarica. */
  declare revision: number;
  declare entries: Entry[] | null;
  declare error: string | null;
  declare filter: string;
  declare size: ThumbSize;
  /** Immagine aperta in grande (il suo percorso), o null. */
  declare open: string | null;
  declare dims: { w: number; h: number } | null;
  private loadSeq = 0;

  constructor() {
    super();
    this.path = '';
    this.revision = 0;
    this.entries = null;
    this.error = null;
    this.filter = '';
    this.size = savedSize();
    this.open = null;
    this.dims = null;
  }

  static override styles = [
    sharedStyles,
    css`
      :host {
        position: absolute;
        inset: 0;
        z-index: 20;
        display: flex;
        flex-direction: column;
        background: var(--bg);
      }
      header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px 8px 14px;
        border-bottom: 1px solid var(--border);
        background: var(--surface);
        flex-wrap: wrap;
      }
      header h2 {
        flex: 1;
        min-width: 0;
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      header small {
        margin-left: 8px;
        font-weight: 400;
        color: var(--text-muted);
      }
      .search {
        position: relative;
      }
      .search svg {
        position: absolute;
        left: 9px;
        top: 8px;
        color: var(--text-faint);
        pointer-events: none;
      }
      .search .input {
        width: 200px;
        height: 32px;
        padding-left: 30px;
        font-size: 13px;
      }
      .sizes {
        display: flex;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        overflow: hidden;
      }
      .sizes button {
        padding: 5px 10px;
        border: none;
        background: transparent;
        color: var(--text-muted);
        font-size: 12px;
        cursor: pointer;
      }
      .sizes button[aria-pressed='true'] {
        background: var(--surface-3);
        color: var(--text);
      }
      .body {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 12px 16px 16px;
      }
      .note {
        margin: 0 0 12px;
        font-size: 12px;
        color: var(--text-muted);
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(var(--cell), 1fr));
        gap: 12px;
      }
      .card {
        display: flex;
        flex-direction: column;
        min-width: 0;
        padding: 8px;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--surface);
        color: var(--text);
        text-align: left;
        cursor: pointer;
      }
      .card:hover,
      .card:focus-visible {
        border-color: var(--accent);
        background: var(--accent-soft);
        outline: none;
      }
      .thumb,
      .stage {
        /* Scacchiera: si vedono le parti trasparenti delle immagini. */
        background-color: var(--editor-bg);
        background-image: linear-gradient(45deg, var(--hover) 25%, transparent 25%),
          linear-gradient(-45deg, var(--hover) 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, var(--hover) 75%),
          linear-gradient(-45deg, transparent 75%, var(--hover) 75%);
        background-size: 14px 14px;
        background-position: 0 0, 0 7px, 7px -7px, -7px 0;
      }
      .thumb {
        display: flex;
        align-items: center;
        justify-content: center;
        height: var(--thumb);
        border-radius: var(--radius-sm);
        overflow: hidden;
        color: var(--text-faint);
      }
      .thumb img {
        max-width: 90%;
        max-height: 90%;
        object-fit: contain;
      }
      .thumb .big {
        padding: 6px;
        font-size: 11px;
        text-align: center;
      }
      .name {
        margin-top: 7px;
        font-family: var(--font-code);
        font-size: 12.5px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .meta {
        font-size: 11px;
        color: var(--text-faint);
      }
      .viewer:focus {
        outline: none;
      }
      .viewer {
        position: absolute;
        inset: 0;
        z-index: 5;
        display: flex;
        flex-direction: column;
        background: var(--bg);
      }
      .viewer .stage {
        position: relative;
        flex: 1;
        min-height: 0;
        display: flex;
        padding: 16px 56px;
      }
      .viewer .stage img {
        margin: auto;
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }
      .viewer .nav {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: var(--surface);
        box-shadow: var(--shadow);
      }
      .viewer .nav.prev {
        left: 10px;
      }
      .viewer .nav.next {
        right: 10px;
      }
    `,
  ];

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('path')) {
      this.filter = '';
      this.open = null;
      this.entries = null;
    }
    if (changed.has('path') || changed.has('revision')) void this.load();
  }

  override updated(changed: Map<string, unknown>): void {
    if (!changed.has('open')) return;
    const before = changed.get('open') as string | null | undefined;
    if (this.open !== null && before == null) {
      // Il visore prende il focus: frecce ed Esc vanno a lui, non alle miniature dietro.
      (this.renderRoot.querySelector('.viewer') as HTMLElement | null)?.focus();
    } else if (this.open === null && before) {
      // Chiuso: il focus torna sulla miniatura da cui si era partiti.
      (this.renderRoot.querySelector(`.card[data-path="${CSS.escape(before)}"]`) as HTMLElement | null)?.focus();
    }
  }

  private async load(): Promise<void> {
    const seq = ++this.loadSeq;
    try {
      const res = await api.tree(this.path);
      if (seq !== this.loadSeq) return;
      this.entries = res.entries.filter((e) => e.type === 'file' && previewKind(e.path) === 'image');
      this.error = null;
      // L'immagine aperta può essere sparita (eliminata, rinominata): si torna alla griglia.
      if (this.open !== null && !this.visible().some((e) => e.path === this.open)) this.open = null;
    } catch (err) {
      if (seq !== this.loadSeq) return;
      this.entries = [];
      this.error = err instanceof ApiError ? errorText(err) : t('gallery.loadError');
    }
  }

  private visible(): Entry[] {
    const q = this.filter.trim().toLowerCase();
    const all = this.entries ?? [];
    return q ? all.filter((e) => e.name.toLowerCase().includes(q)) : all;
  }

  private setSize(size: ThumbSize): void {
    this.size = size;
    try {
      localStorage.setItem(SIZE_KEY, size);
    } catch {
      // Solo una comodità: senza memoria del browser si riparte da «medie».
    }
  }

  /** Tasti del visore: solo quando il focus è lì (non nei campi o negli altri pannelli). */
  private onViewerKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    if (e.key === 'Escape') this.show(null);
    else if (e.key === 'ArrowRight') this.step(1);
    else if (e.key === 'ArrowLeft') this.step(-1);
    else return;
    // Esc gestito qui: l'app (che ascolta sulla finestra) non chiude anche la galleria.
    e.preventDefault();
  }

  private step(delta: number): void {
    const list = this.visible();
    const i = list.findIndex((e) => e.path === this.open);
    if (i < 0 || list.length === 0) return;
    this.show(list[(i + delta + list.length) % list.length]!.path);
  }

  private show(path: string | null): void {
    this.dims = null;
    this.open = path;
  }

  private emit(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private onContext(e: MouseEvent, entry: Entry): void {
    e.preventDefault();
    this.emit('gallery-context', { entry, x: e.clientX, y: e.clientY });
  }

  /** Indirizzo dell'immagine: cambia con la data di modifica, così un file sostituito si ricarica. */
  private src(entry: Entry): string {
    return `${api.previewUrl(entry.path)}&v=${encodeURIComponent(entry.mtime)}`;
  }

  private renderCard(entry: Entry) {
    const thumb =
      entry.size > MAX_THUMB_BYTES
        ? html`${icon(icons.file, 28)}<span class="big">${t('gallery.tooBig')}</span>`
        : html`<img src=${this.src(entry)} alt="" loading="lazy" decoding="async" />`;
    return html`<button
      class="card"
      title=${entry.name}
      data-path=${entry.path}
      @click=${() => this.show(entry.path)}
      @contextmenu=${(e: MouseEvent) => this.onContext(e, entry)}
    >
      <div class="thumb">${thumb}</div>
      <div class="name">${entry.name}</div>
      <div class="meta">${kb(entry.size)}</div>
    </button>`;
  }

  private renderViewer(list: Entry[]) {
    const index = list.findIndex((e) => e.path === this.open);
    const entry = list[index];
    if (!entry) return nothing;
    const many = list.length > 1;
    return html`<div class="viewer" role="dialog" aria-modal="true" aria-label=${entry.name} tabindex="-1" @keydown=${this.onViewerKey}>
      <header>
        <h2 title=${entry.path}>
          ${entry.name}<small>${this.dims ? `${this.dims.w} × ${this.dims.h} px · ` : ''}${kb(entry.size)} ·
            ${t('gallery.position', { n: index + 1, total: list.length })}</small>
        </h2>
        <button class="icon-btn small" title=${t('tree.download')} @click=${() => this.emit('preview-download', { path: entry.path })}>
          ${icon(icons.download, 18)}
        </button>
        <button class="icon-btn small" title=${t('gallery.back')} @click=${() => this.show(null)}>
          ${icon(icons.close, 18)}
        </button>
      </header>
      <div class="stage" @contextmenu=${(e: MouseEvent) => this.onContext(e, entry)}>
        <img
          src=${this.src(entry)}
          alt=${entry.name}
          @load=${(e: Event) => {
            const img = e.target as HTMLImageElement;
            this.dims = { w: img.naturalWidth, h: img.naturalHeight };
          }}
        />
        ${many
          ? html`<button class="icon-btn nav prev" title=${t('gallery.prev')} @click=${() => this.step(-1)}>
                ${icon(icons.chevronLeft, 22)}
              </button>
              <button class="icon-btn nav next" title=${t('gallery.next')} @click=${() => this.step(1)}>
                ${icon(icons.chevronRight, 22)}
              </button>`
          : nothing}
      </div>
    </div>`;
  }

  override render() {
    const list = this.visible();
    const total = this.entries?.length ?? 0;
    const cell = { s: 96, m: 132, l: 200 }[this.size];
    const thumb = { s: 64, m: 92, l: 150 }[this.size];
    const sizes: [ThumbSize, string][] = [
      ['s', t('gallery.small')],
      ['m', t('gallery.medium')],
      ['l', t('gallery.large')],
    ];
    return html`
      <header>
        <span style="color:var(--folder, #e5b33a)">${icon(icons.folder, 18)}</span>
        <h2 title=${this.path}>/config/${this.path}<small>${total === 1 ? t('gallery.countOne') : t('gallery.count', { n: total })}</small></h2>
        <div class="search">
          ${icon(icons.search, 16)}
          <input
            class="input"
            .value=${this.filter}
            placeholder=${t('gallery.filter')}
            aria-label=${t('gallery.filter')}
            @input=${(e: Event) => {
              this.filter = (e.target as HTMLInputElement).value;
              this.open = null;
            }}
          />
        </div>
        <div class="sizes" role="group" aria-label=${t('gallery.size')}>
          ${sizes.map(
            ([id, label]) => html`<button aria-pressed=${this.size === id} @click=${() => this.setSize(id)}>${label}</button>`,
          )}
        </div>
        <button class="icon-btn small" title=${t('common.close')} @click=${() => this.emit('preview-close', { path: this.path })}>
          ${icon(icons.close, 18)}
        </button>
      </header>
      <div class="body" style="--cell:${cell}px;--thumb:${thumb}px">
        ${this.entries === null
          ? nothing
          : this.error
            ? html`<p class="note">${this.error}</p>`
            : total === 0
              ? html`<p class="note">${t('gallery.empty')}</p>`
              : html`<p class="note">
                    ${this.filter.trim() ? t('gallery.filtered', { n: list.length, total }) : t('gallery.hint')}
                  </p>
                  <div class="grid">${repeat(list, (e) => e.path, (e) => this.renderCard(e))}</div>`}
      </div>
      ${this.open !== null ? this.renderViewer(list) : nothing}
    `;
  }
}

customElements.define('editha-gallery-panel', EdithaGalleryPanel);
