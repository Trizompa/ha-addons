import { LitElement, css, html, nothing } from 'lit';
import { api } from '../api/client.js';
import { t } from '../i18n/index.js';
import { basename } from '../state/paths.js';
import { previewKind } from '../state/preview.js';
import { fileIcon, icon, icons } from '../ui/icons.js';
import { sharedStyles } from '../ui/shared-styles.js';

/**
 * FS-10: anteprima di immagini e PDF, in sola lettura, al posto dell'editor.
 * Le immagini stanno nella finestra; un clic le mostra a grandezza reale.
 */
export class EdithaPreviewPanel extends LitElement {
  static override properties = {
    path: { type: String },
    actual: { state: true },
    size: { state: true },
    zoom: { state: true },
    failed: { state: true },
    pdfReady: { state: true },
  };

  declare path: string;
  declare actual: boolean;
  declare size: { w: number; h: number } | null;
  /** Percentuale a cui l'immagine è mostrata rispetto ai suoi pixel. */
  declare zoom: number | null;
  private resizeObserver: ResizeObserver | null = null;
  /** Spiegazione del perché l'anteprima non si vede; null finché va tutto bene. */
  declare failed: string | null;
  /** PDF: il server risponde bene, si può caricare nel riquadro (mai il JSON di un errore). */
  declare pdfReady: boolean;
  /** Controllo in corso: un cambio di file rende vecchie le risposte precedenti. */
  private check = 0;

  constructor() {
    super();
    this.path = '';
    this.actual = false;
    this.size = null;
    this.zoom = null;
    this.failed = null;
    this.pdfReady = false;
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
        gap: 8px;
        padding: 8px 10px 8px 14px;
        border-bottom: 1px solid var(--border);
        background: var(--surface);
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
      .stage {
        flex: 1;
        min-height: 0;
        overflow: auto;
        display: flex;
        padding: 16px;
        /* Scacchiera: si vedono le parti trasparenti delle immagini. */
        background-color: var(--editor-bg);
        background-image: linear-gradient(45deg, var(--hover) 25%, transparent 25%),
          linear-gradient(-45deg, var(--hover) 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, var(--hover) 75%),
          linear-gradient(-45deg, transparent 75%, var(--hover) 75%);
        background-size: 20px 20px;
        background-position: 0 0, 0 10px, 10px -10px, -10px 0;
      }
      .stage img {
        display: block;
        /* Centrata finché ci sta; se è più grande si scorre dal bordo, senza tagli. */
        margin: auto;
        flex: none;
        cursor: zoom-in;
        image-rendering: auto;
      }
      .stage:not(.actual) img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }
      .stage.actual img {
        cursor: zoom-out;
      }
      iframe {
        flex: 1;
        min-height: 0;
        width: 100%;
        border: none;
        background: var(--editor-bg);
      }
      .note {
        padding: 16px;
        font-size: 13px;
        color: var(--text-muted);
      }
    `,
  ];

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('path')) {
      this.actual = false;
      this.size = null;
      this.zoom = null;
      this.failed = null;
      this.pdfReady = false;
      const token = ++this.check;
      if (this.path && previewKind(this.path) === 'pdf') {
        void this.diagnose(token).then((message) => {
          if (token !== this.check) return;
          if (message) this.failed = message;
          else this.pdfReady = true;
        });
      }
    }
  }

  /**
   * Chiede al server lo stato dell'anteprima (senza cache) per spiegare un errore preciso:
   * file sparito, troppo grande, non consentito. Null se la risposta è buona.
   */
  private async diagnose(token: number): Promise<string | null> {
    const pdf = previewKind(this.path) === 'pdf';
    const generic = pdf ? t('preview.failedPdf') : t('preview.failed');
    let status: number;
    try {
      const url = api.previewUrl(this.path);
      let res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      // HEAD non accettato da un proxy: si chiede il file, senza leggerne il contenuto.
      if (res.status === 405) {
        res = await fetch(url, { cache: 'no-store' });
        void res.body?.cancel();
      }
      status = res.status;
    } catch {
      return token === this.check ? generic : null;
    }
    if (status === 404) return t('preview.notFound');
    if (status === 413) return t('preview.tooLarge');
    if (status === 403) return t('preview.forbidden');
    if (status >= 200 && status < 300) return pdf ? null : generic;
    return generic;
  }

  private onError(): void {
    const token = this.check;
    void this.diagnose(token).then((message) => {
      if (token === this.check) this.failed = message ?? t('preview.failed');
    });
  }

  override updated(): void {
    const img = this.renderRoot.querySelector('img');
    if (!img) return;
    if (!this.resizeObserver) this.resizeObserver = new ResizeObserver(() => this.measure());
    this.resizeObserver.disconnect();
    this.resizeObserver.observe(img);
  }

  override disconnectedCallback(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    super.disconnectedCallback();
  }

  private measure(): void {
    const img = this.renderRoot.querySelector('img');
    if (!img || !img.naturalWidth) return;
    const zoom = Math.round((img.clientWidth / img.naturalWidth) * 100);
    if (zoom !== this.zoom) this.zoom = zoom;
  }

  private emit(name: string): void {
    this.dispatchEvent(new CustomEvent(name, { detail: { path: this.path }, bubbles: true, composed: true }));
  }

  private onLoad(e: Event): void {
    const img = e.target as HTMLImageElement;
    this.size = { w: img.naturalWidth, h: img.naturalHeight };
    this.measure();
  }

  private renderBody() {
    const url = api.previewUrl(this.path);
    if (this.failed) return html`<div class="note">${this.failed}</div>`;
    if (previewKind(this.path) === 'pdf') {
      return this.pdfReady ? html`<iframe src=${url} title=${basename(this.path)}></iframe>` : nothing;
    }
    return html`<div class="stage ${this.actual ? 'actual' : ''}">
      <img
        src=${url}
        alt=${basename(this.path)}
        title=${this.actual ? t('preview.fit') : t('preview.actual')}
        @load=${this.onLoad}
        @error=${this.onError}
        @click=${() => (this.actual = !this.actual)}
      />
    </div>`;
  }

  override render() {
    return html`
      <header>
        <span style="color:${fileIcon(this.path).color}">${icon(fileIcon(this.path).path, 18)}</span>
        <h2 title=${this.path}>
          /config/${this.path}${this.size ? html`<small>${this.size.w} × ${this.size.h} px${this.zoom ? ` · ${this.zoom}%` : ''}</small>` : nothing}
        </h2>
        <button class="icon-btn small" data-action="download" title=${t('tree.download')} @click=${() => this.emit('preview-download')}>
          ${icon(icons.download, 18)}
        </button>
        <button class="icon-btn small" title=${t('common.close')} @click=${() => this.emit('preview-close')}>
          ${icon(icons.close, 18)}
        </button>
      </header>
      ${this.renderBody()}
    `;
  }
}

customElements.define('editha-preview-panel', EdithaPreviewPanel);
