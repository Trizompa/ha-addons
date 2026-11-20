import { LitElement, css, html, nothing } from 'lit';
import type { ThemeMode } from '../api/types.js';
import { icon, icons } from '../ui/icons.js';
import { sharedStyles } from '../ui/shared-styles.js';
import { t } from '../i18n/index.js';
import { shortcutLabel } from '../state/keys.js';

export interface ToolbarState {
  hasTab: boolean;
  canSave: boolean;
  canSaveAll: boolean;
  canUndo: boolean;
  canRedo: boolean;
  wordWrap: boolean;
  sidebarVisible: boolean;
  theme: ThemeMode;
  insertOpen: boolean;
  haBusy: boolean;
  lang: string;
  /** Vista divisa attiva (ED-17). */
  split: boolean;
  /** Pannello di ricerca in tutti i file aperto (SR-1). */
  searchOpen: boolean;
  /** Schema del file a fianco dell'editor (ED-18). */
  outline: boolean;
  /** Cronologia del file aperta: il pulsante la chiude. */
  historyOpen: boolean;
  /** Aiuti di Home Assistant accesi (HA-12). */
  haHints: boolean;
  /** Cerca e sostituisci aperto nel file attivo. */
  findOpen: boolean;
  /** Pannello dell'anteprima dei template aperto. */
  templateOpen: boolean;
  /** Grandezza del testo: 0 = automatica. */
  fontSize: number;
}

const THEME_ICON: Record<ThemeMode, string> = { auto: icons.themeAuto, light: icons.themeLight, dark: icons.themeDark };

/**
 * Barra superiore: ogni comando agisce sulla tab attiva e il suo stato
 * (abilitato o no) riflette quella tab (UI-6, FEP #15).
 */
export class EdithaToolbar extends LitElement {
  static override properties = { state: { attribute: false } };
  declare state: ToolbarState;

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        align-items: center;
        gap: 2px;
        height: 48px;
        padding: 0 10px;
        flex: none;
        background: var(--surface);
        border-bottom: 1px solid var(--border);
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 10px;
        /* Dal testo al primo pulsante la stessa distanza che c'è tra logo e "EDITHA" (10px, gap compreso). */
        margin: 0 8px 0 4px;
        font-weight: 650;
        font-size: 15px;
        letter-spacing: 0.01em;
      }
      .brand small {
        /* Stessa distanza che separa il logo da "EDITHA" (gap di .brand). */
        margin-left: 10px;
        font-weight: 500;
        color: var(--text-faint);
        font-size: 12px;
      }
      .logo {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border-radius: 8px;
        background: linear-gradient(135deg, var(--accent), #6a5cff);
        color: #fff;
        font-weight: 700;
        font-size: 15px;
      }
      .lang {
        width: auto;
        min-width: 32px;
        padding: 0 6px;
        font-size: 12px;
        font-weight: 650;
        letter-spacing: 0.04em;
      }
      .spacer {
        flex: 1;
      }
      /* Verifica, ricarica e riavvio: pulsante con scritta, separato dagli strumenti dell'editor. */
      .ha-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 32px;
        margin-right: 8px;
        padding: 0 6px 0 10px;
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-sm);
        background: var(--surface);
        color: var(--text);
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
        transition: background 0.12s;
      }
      .ha-btn:hover:not(:disabled) {
        background: var(--hover);
      }
      .ha-btn:active:not(:disabled) {
        background: var(--active);
      }
      .ha-btn:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .ha-btn:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
      }
      /* Modifiche da salvare: icona blu e pallino, visibili a colpo d'occhio. */
      .pending,
      .icon-btn.pending:hover:not(:disabled) {
        position: relative;
        color: var(--accent);
      }
      .pending::after {
        content: '';
        position: absolute;
        top: 4px;
        right: 4px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--warning);
        box-shadow: 0 0 0 2px var(--surface);
      }
      @media (max-width: 760px) {
        .brand small,
        .hide-narrow {
          display: none;
        }
        /* Su telefono (iPhone: 375-390 px) tutti i pulsanti devono stare nella riga. */
        :host {
          gap: 0;
          padding: 0 6px;
        }
        /* Su telefono basta il nome: il logo lascia spazio ai pulsanti. */
        .brand .logo {
          display: none;
        }
        .brand {
          margin: 0 8px 0 4px;
        }
        .sep {
          display: none;
        }
        /* Sul telefono solo l'icona, come gli altri pulsanti. */
        .ha-btn {
          justify-content: center;
          width: 30px;
          margin-right: 0;
          padding: 0;
          border: none;
          background: transparent;
          color: var(--text-muted);
        }
        .ha-btn .ha-label,
        .ha-btn svg + svg {
          display: none;
        }
        .icon-btn {
          flex: none;
          width: 30px;
        }
        .lang {
          min-width: 28px;
          padding: 0 4px;
        }
      }
      /* iPhone stretti (375 px) compresi: con 30 px l'ultimo pulsante usciva di mezzo pixel. */
      @media (max-width: 380px) {
        .icon-btn,
        .ha-btn {
          width: 28px;
        }
        .brand {
          margin: 0 4px 0 2px;
          font-size: 14px;
        }
      }
    `,
  ];

  private action(name: string, e?: Event): void {
    const rect = (e?.currentTarget as HTMLElement | undefined)?.getBoundingClientRect();
    this.dispatchEvent(
      new CustomEvent('toolbar-action', { detail: { action: name, rect }, bubbles: true, composed: true }),
    );
  }

  private button(name: string, label: string, path: string, opts: { disabled?: boolean; on?: boolean; cls?: string } = {}) {
    return html`<button
      class="icon-btn ${opts.on ? 'on' : ''} ${opts.cls ?? ''}"
      title=${shortcutLabel(label)}
      aria-label=${label}
      aria-pressed=${opts.on === undefined ? nothing : String(opts.on)}
      ?disabled=${opts.disabled}
      @click=${(e: Event) => this.action(name, e)}
    >
      ${icon(path, 20)}
    </button>`;
  }

  override render() {
    const s = this.state;
    return html`
      <div class="brand"><span class="logo">E</span><span>EDITHA<small>${t('app.tagline')}</small></span></div>
      ${this.button('toggle-sidebar', t('toolbar.sidebar'), icons.sidebar, { on: s.sidebarVisible })}
      ${this.button('save', t('toolbar.save'), icons.save, { disabled: !s.canSave, cls: s.canSave ? 'pending' : '' })}
      ${this.button('save-all', t('toolbar.saveAll'), icons.saveAll, {
        disabled: !s.canSaveAll,
        cls: `hide-narrow ${s.canSaveAll ? 'pending' : ''}`,
      })}
      <span class="sep"></span>
      ${this.button('undo', t('toolbar.undo'), icons.undo, { disabled: !s.canUndo })}
      ${this.button('redo', t('toolbar.redo'), icons.redo, { disabled: !s.canRedo })}
      ${this.button('search', t('toolbar.search'), icons.replace, { on: s.findOpen, disabled: !s.hasTab })}
      ${this.button('history', t('toolbar.history'), icons.history, { on: s.historyOpen, disabled: !s.hasTab && !s.historyOpen, cls: 'hide-narrow' })}
      ${this.button('word-wrap', t('toolbar.wrap'), icons.wrap, { on: s.wordWrap, disabled: !s.hasTab, cls: 'hide-narrow' })}
      ${this.button('split', t('toolbar.split'), icons.split, { on: s.split, disabled: !s.hasTab && !s.split, cls: 'hide-narrow' })}
      ${this.button('outline', t('toolbar.outline'), icons.outline, { on: s.outline, disabled: !s.hasTab && !s.outline, cls: 'hide-narrow' })}
      <span class="sep"></span>
      ${this.button('insert', t('toolbar.insert'), icons.insert, { on: s.insertOpen, disabled: !s.hasTab && !s.insertOpen })}
      ${this.button('template', t('toolbar.template'), icons.template, { on: s.templateOpen, disabled: !s.hasTab && !s.templateOpen })}
      ${this.button('ha-hints', t('toolbar.haHints'), icons.haHints, { on: s.haHints, cls: 'hide-narrow' })}
      <span class="spacer"></span>
      <button
        class="ha-btn"
        title=${t('toolbar.ha')}
        aria-label=${t('toolbar.ha')}
        ?disabled=${s.haBusy}
        @click=${(e: Event) => this.action('ha-menu', e)}
      >
        ${icon(icons.homeAssistant, 18)}<span class="ha-label">${t('toolbar.haLabel')}</span>${icon(icons.menuDown, 18)}
      </button>
      ${this.renderPrefs()}
    `;
  }

  private renderPrefs() {
    const s = this.state;
    return html`
      <button
        class="icon-btn lang"
        title=${t('toolbar.language', { name: t(`language.${s.lang as 'it' | 'en'}`) })}
        aria-label=${t('toolbar.language', { name: t(`language.${s.lang as 'it' | 'en'}`) })}
        @click=${(e: Event) => this.action('language', e)}
      >
        ${s.lang.toUpperCase()}
      </button>
      <button
        class="icon-btn lang text-size hide-narrow"
        title=${t('toolbar.fontSize', { name: s.fontSize ? t('fontSize.px', { n: s.fontSize }) : t('fontSize.auto') })}
        aria-label=${t('toolbar.fontSize', { name: s.fontSize ? t('fontSize.px', { n: s.fontSize }) : t('fontSize.auto') })}
        data-action="font-size"
        @click=${(e: Event) => this.action('font-size', e)}
      >
        Aa
      </button>
      ${this.button('theme', t('toolbar.theme', { name: t(`theme.${s.theme}`) }), THEME_ICON[s.theme])}
      ${this.button('about', t('toolbar.about'), icons.about, { cls: 'hide-narrow' })}
    `;
  }
}

customElements.define('editha-toolbar', EdithaToolbar);
