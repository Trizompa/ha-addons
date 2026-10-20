import { LitElement, css, html } from 'lit';
import { t } from '../i18n/index.js';
import { sharedStyles } from '../ui/shared-styles.js';
import { VERSION } from '../version.js';

const REPOSITORY = 'https://github.com/Trizompa/ha-addons';

/** Finestra "Informazioni": autore, versione, licenza e riconoscimenti. */
export class EdithaAboutDialog extends LitElement {
  static override styles = [
    sharedStyles,
    css`
      dialog {
        width: min(400px, calc(100vw - 32px));
        padding: 24px 24px 18px;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        background: var(--surface);
        color: var(--text);
        box-shadow: var(--shadow-pop);
      }
      dialog::backdrop {
        background: var(--scrim);
        backdrop-filter: blur(2px);
      }
      .head {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        margin-bottom: 18px;
        text-align: center;
      }
      .logo {
        display: grid;
        place-items: center;
        width: 56px;
        height: 56px;
        border-radius: 16px;
        background: linear-gradient(135deg, var(--accent), #6a5cff);
        color: #fff;
        font-weight: 700;
        font-size: 28px;
      }
      h2 {
        margin: 6px 0 0;
        font-size: 18px;
      }
      .tagline {
        color: var(--text-muted);
        font-size: 13px;
      }
      dl {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 8px 18px;
        margin: 0;
        font-size: 13px;
      }
      dt {
        color: var(--text-muted);
      }
      dd {
        margin: 0;
        font-weight: 500;
        overflow-wrap: anywhere;
      }
      a {
        color: var(--accent);
        text-decoration: none;
      }
      a:hover,
      button.link:hover {
        text-decoration: underline;
      }
      button.link {
        padding: 0;
        border: none;
        background: none;
        color: var(--accent);
        font: inherit;
        cursor: pointer;
      }
      .thanks {
        margin: 16px 0 0;
        padding-top: 12px;
        border-top: 1px solid var(--border);
        color: var(--text-muted);
        font-size: 12px;
        line-height: 1.5;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 16px;
      }
    `,
  ];

  show(): void {
    (this.renderRoot.querySelector('dialog') as HTMLDialogElement).showModal();
  }

  /** La finestra della cronologia si apre al posto di questa. */
  private openSpace(): void {
    this.close();
    this.dispatchEvent(new CustomEvent('history-space', { bubbles: true, composed: true }));
  }

  private close(): void {
    (this.renderRoot.querySelector('dialog') as HTMLDialogElement).close();
  }

  override render() {
    return html`<dialog aria-labelledby="about-title" @click=${(e: Event) => e.target === e.currentTarget && this.close()}>
      <div class="head">
        <div class="logo">E</div>
        <h2 id="about-title">EDITHA</h2>
        <div class="tagline">${t('app.tagline')}</div>
      </div>
      <dl>
        <dt>${t('about.developer')}</dt>
        <dd><a href="https://github.com/Trizompa" target="_blank" rel="noopener noreferrer">Trizompa</a></dd>
        <dt>${t('about.repository')}</dt>
        <dd><a href=${REPOSITORY} target="_blank" rel="noopener noreferrer">${REPOSITORY.replace('https://', '')}</a></dd>
        <dt>${t('about.version')}</dt>
        <dd data-field="version">${VERSION}</dd>
        <dt>${t('about.license')}</dt>
        <dd>MIT</dd>
        <dt>${t('about.history')}</dt>
        <dd>
          <button class="link" data-action="history-space" @click=${() => this.openSpace()}>${t('space.open')}</button>
        </dd>
      </dl>
      <p class="thanks">${t('about.thanks')}</p>
      <div class="actions">
        <button class="btn" @click=${() => this.close()}>${t('common.close')}</button>
      </div>
    </dialog>`;
  }
}

customElements.define('editha-about-dialog', EdithaAboutDialog);
