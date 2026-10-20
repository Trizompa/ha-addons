import { LitElement, css, html } from 'lit';
import type { ChangeSet, EditorState, StateEffect, Text } from '@codemirror/state';
import type { ViewUpdate } from '@codemirror/view';
import { redoDepth, undoDepth } from '@codemirror/commands';
import { forEachDiagnostic } from '@codemirror/lint';
import { api, ApiError, CLIENT_ID, errorText, forgetKeptClientId, keepClientId, whileLeaving } from '../api/client.js';
import { getLang, onLangChange, resolveLang, setLang, t, type LanguageSetting, type MessageKey } from '../i18n/index.js';
import { connection } from '../api/connection.js';
import type { Draft, Entry, ListedDraft, Session, Settings, ThemeMode } from '../api/types.js';
import { createEditorState, docText, reconfigureEffects } from '../editor/setup.js';
import { languageOf } from '../editor/languages.js';
import { LINT_MAX_CHARS } from '../editor/yaml-lint.js';
import { basename, dirname, extension, join, resolvePath, validateName } from '../state/paths.js';
import { previewKind } from '../state/preview.js';
import { shortcutKey } from '../state/keys.js';
import { forgetSecrets, secretKeys } from '../state/secrets.js';
import type { LinkKind } from '../editor/links.js';
import { TabsModel } from '../state/tabs.js';
import { icon, icons } from '../ui/icons.js';
import { sharedStyles } from '../ui/shared-styles.js';
import type { EdithaContextMenu, MenuEntry } from './context-menu.js';
import type { EdithaDialog } from './dialog.js';
import { fromOtherPane, programmatic, type EdithaEditorPane, type EditorTab } from './editor-pane.js';
import type { EdithaFileTree } from './file-tree.js';
import type { StatusInfo } from './status-bar.js';
import type { TabView } from './tab-bar.js';
import type { EdithaToasts } from './toasts.js';
import type { ToolbarState } from './toolbar.js';
import type { EdithaInsertPanel, InsertTab } from './insert-panel.js';
import type { Snippet } from '../api/types.js';
import { haData } from '../state/ha-data.js';
import { fillIds, normalizeSnippetBody } from '../editor/snippets.js';
import './context-menu.js';
import './dialog.js';
import './editor-pane.js';
import './file-tree.js';
import './status-bar.js';
import './tab-bar.js';
import './toasts.js';
import './toolbar.js';
import './insert-panel.js';
import './history-panel.js';
import './side-pane.js';
import './about-dialog.js';
import './history-space.js';
import type { EdithaHistorySpace } from './history-space.js';
import './folder-picker.js';
import './search-panel.js';
import './compare-panel.js';
import './preview-panel.js';
import './outline-panel.js';
import { activeOutlineIndex, buildOutline, type OutlineItem } from '../editor/outline.js';
import './snippet-editor.js';
import type { EdithaSnippetEditor } from './snippet-editor.js';
import type { CompareSide } from './compare-panel.js';
import {
  ENTITY_ID,
  replaceConfirmMessage,
  replaceDoneMessage,
  replaceSkippedMessage,
  type EdithaSearchPanel,
  type SearchRequest,
} from './search-panel.js';
import type { SearchMatch } from '../api/types.js';
import type { EdithaFolderPicker } from './folder-picker.js';
import type { EdithaAboutDialog } from './about-dialog.js';
import type { EdithaSidePane } from './side-pane.js';
import { formatVersionDate, type EdithaHistoryPanel } from './history-panel.js';

const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  sidebarVisible: true,
  sidebarWidth: 280,
  wordWrap: false,
  fontSize: 14,
  showSystem: false,
  language: 'auto',
  outlineVisible: false,
};

const NARROW = '(max-width: 760px)';

/** Come LIVE_MS del server: dopo questo silenzio una finestra si considera chiusa. */
const DRAFT_LIVE_MS = 90_000;

/** Errori di apertura che non passano da soli: una bozza di quel file non si potrà mai salvare. */
const PERMANENT_OPEN_ERRORS = new Set(['not_found', 'not_a_file', 'forbidden_path', 'binary', 'too_large']);

/** Componente principale: tiene insieme albero, tab, editor e barre. */
export class EdithaApp extends LitElement {
  static override properties = {
    settings: { state: true },
    tabViews: { state: true },
    activePath: { state: true },
    status: { state: true },
    toolbar: { state: true },
    narrow: { state: true },
    drawerOpen: { state: true },
    insertOpen: { state: true },
    insertTab: { state: true },
    userSnippets: { state: true },
    haBusy: { state: true },
    offline: { state: true },
    addonUpdated: { state: true },
    history: { state: true },
    split: { state: true },
    sideFocused: { state: true },
    searchOpen: { state: true },
    compare: { state: true },
    preview: { state: true },
    previewShown: { state: true },
    outline: { state: true },
    outlineActive: { state: true },
  };

  declare settings: Settings;
  declare tabViews: TabView[];
  declare activePath: string | null;
  declare status: StatusInfo | null;
  declare toolbar: ToolbarState;
  declare narrow: boolean;
  declare drawerOpen: boolean;
  declare insertOpen: boolean;
  declare insertTab: InsertTab;
  declare userSnippets: Snippet[];
  /** Un'operazione su HA è in corso: il menu resta disabilitato. */
  declare haBusy: boolean;
  /** Il server non risponde (add-on in aggiornamento o riavvio, sessione scaduta). */
  declare offline: boolean;
  /** L'add-on è stato aggiornato mentre la pagina era aperta. */
  declare addonUpdated: boolean;
  /** Cronologia aperta: file e contenuto attuale con cui confrontare le versioni. */
  declare history: { path: string; current: string; readOnly: boolean } | null;
  /** ED-17: vista divisa in due colonne (solo su schermi larghi). */
  declare split: boolean;
  /** L'ultima colonna usata è quella destra: salva, annulla, inserisci agiscono lì. */
  declare sideFocused: boolean;
  /** SR-1: nella barra laterale c'è la ricerca al posto dell'albero. */
  declare searchOpen: boolean;
  /** BK-6: confronto tra due file aperto. */
  declare compare: { left: CompareSide; right: CompareSide } | null;
  /** FS-10: immagine o PDF mostrato al posto dell'editor. */
  declare preview: string | null;
  /** La tab di anteprima è quella in primo piano (l'editor sotto non riceve comandi). */
  declare previewShown: boolean;
  /** ED-18: schema del file in uso (null se non è YAML) e voce in cui si trova il cursore. */
  declare outline: OutlineItem[] | null;
  declare outlineActive: number;
  private outlineDoc: unknown = null;
  private outlineTab: EditorTab | null = null;
  private outlineTimer: ReturnType<typeof setTimeout> | undefined;
  /** Primo file scelto per un confronto (menu "Seleziona per il confronto"). */
  private compareBase: string | null = null;
  private build: string | null = null;
  private offLang: (() => void) | null = null;
  private healthTimer: ReturnType<typeof setInterval> | undefined;

  private readonly tabs = new TabsModel<EditorState>();
  /** Testo salvato su disco per ogni tab: serve a sapere se ci sono modifiche. */
  private readonly saved = new WeakMap<EditorTab, Text>();
  private sessionTimer: ReturnType<typeof setTimeout> | undefined;
  private sessionReady = false;
  private readonly narrowQuery = window.matchMedia(NARROW);
  private readonly touchQuery = window.matchMedia('(pointer: coarse)');
  private editorFocused = false;
  /** ED-14: bozze in attesa di scrittura e file che hanno una bozza sul server. */
  private readonly draftTimers = new Map<EditorTab, ReturnType<typeof setTimeout>>();
  private readonly drafted = new Set<string>();
  /** Cresce a ogni salvataggio o scarto: una bozza in viaggio da prima è vecchia e va tolta. */
  private readonly draftGen = new WeakMap<EditorTab, number>();

  constructor() {
    super();
    this.settings = DEFAULT_SETTINGS;
    this.tabViews = [];
    this.activePath = null;
    this.status = null;
    this.narrow = this.narrowQuery.matches;
    this.drawerOpen = false;
    this.insertOpen = false;
    this.insertTab = 'entities';
    this.userSnippets = [];
    this.haBusy = false;
    this.offline = false;
    this.addonUpdated = false;
    this.history = null;
    this.split = false;
    this.sideFocused = false;
    this.searchOpen = false;
    this.compare = null;
    this.preview = null;
    this.previewShown = false;
    this.outline = null;
    this.outlineActive = -1;
    this.toolbar = this.computeToolbar();
  }

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--bg);
      }
      .body {
        position: relative;
        display: flex;
        flex: 1;
        min-height: 0;
      }
      aside {
        flex: none;
        min-width: 0;
        border-right: 1px solid var(--border);
        overflow: hidden;
      }
      .resizer {
        flex: none;
        width: 5px;
        margin-left: -3px;
        margin-right: -2px;
        cursor: col-resize;
        z-index: 2;
      }
      .resizer:hover,
      .resizer.dragging {
        background: var(--accent);
        opacity: 0.5;
      }
      main {
        position: relative;
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
        background: var(--editor-bg);
      }
      .editors {
        position: relative;
        display: flex;
        flex: 1;
        min-height: 0;
      }
      .editors > editha-editor-pane {
        min-width: 0;
      }
      .side {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
        border-left: 1px solid var(--border);
      }
      .side[hidden] {
        display: none;
      }
      .side-head {
        display: flex;
        align-items: center;
        gap: 4px;
        height: 34px;
        padding: 0 4px 0 8px;
        border-bottom: 1px solid var(--border);
        background: var(--surface);
        border-top: 2px solid transparent;
      }
      .side.focused .side-head {
        border-top-color: var(--accent);
      }
      .side-head select {
        flex: 1;
        min-width: 0;
        height: 26px;
        border: none;
        border-radius: var(--radius-sm);
        background: var(--surface);
        color: var(--text);
        font: inherit;
        font-size: 13px;
        cursor: pointer;
      }
      .side-head select:hover {
        background: var(--hover);
      }
      /* Su Windows l'elenco aperto prende i colori dalle opzioni: senza, nel tema scuro
         il testo chiaro finiva su sfondo bianco. */
      .side-head select option {
        background: var(--surface);
        color: var(--text);
      }
      .side-empty {
        display: grid;
        place-items: center;
        padding: 24px;
        color: var(--text-muted);
        font-size: 13px;
        text-align: center;
      }
      editha-insert-panel {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        /* Sopra anche ad anteprima, cronologia e confronto (z-index 20). */
        z-index: 25;
      }
      :host([narrow]) editha-insert-panel {
        left: 0;
        width: auto;
      }
      .banner {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 14px;
        flex: none;
        background: var(--danger-soft);
        border-bottom: 1px solid var(--danger);
        color: var(--text);
        font-size: 13px;
      }
      .banner.info {
        background: var(--accent-soft);
        border-bottom-color: var(--accent);
      }
      .banner span {
        flex: 1;
      }
      .banner .btn {
        height: 30px;
        flex: none;
      }
      .drawer-scrim {
        position: absolute;
        inset: 0;
        z-index: 4;
        background: var(--scrim);
      }
      :host([narrow]) aside {
        position: absolute;
        z-index: 5;
        top: 0;
        bottom: 0;
        left: 0;
        width: min(320px, 86vw) !important;
        box-shadow: var(--shadow-pop);
      }
      .welcome {
        display: flex;
        flex-direction: column;
        align-items: center;
        /* "safe": su finestre basse il contenuto scorre invece di uscire sopra la barra. */
        justify-content: safe center;
        overflow: auto;
        gap: 18px;
        padding: 24px;
        text-align: center;
        color: var(--text-muted);
        background: var(--editor-bg);
      }
      .welcome .logo {
        display: grid;
        place-items: center;
        width: 64px;
        height: 64px;
        border-radius: 18px;
        background: linear-gradient(135deg, var(--accent), #6a5cff);
        color: #fff;
        font-size: 32px;
        font-weight: 700;
        box-shadow: var(--shadow);
      }
      .welcome h1 {
        margin: 0;
        color: var(--text);
        font-size: 22px;
        font-weight: 650;
      }
      .welcome p {
        margin: -8px 0 0;
      }
      .keys {
        display: grid;
        grid-template-columns: auto auto;
        gap: 8px 18px;
        margin-top: 8px;
        font-size: 13px;
        text-align: left;
      }
      kbd {
        display: inline-block;
        min-width: 22px;
        padding: 2px 6px;
        border-radius: 5px;
        border: 1px solid var(--border-strong);
        border-bottom-width: 2px;
        background: var(--surface-2);
        color: var(--text);
        font: 11.5px var(--font-ui);
        text-align: center;
      }
    `,
  ];

  // ——— elementi figli ———

  private get pane(): EdithaEditorPane {
    return this.renderRoot.querySelector('editha-editor-pane') as EdithaEditorPane;
  }
  private get tree(): EdithaFileTree {
    return this.renderRoot.querySelector('editha-file-tree') as EdithaFileTree;
  }
  private get dialog(): EdithaDialog {
    return this.renderRoot.querySelector('editha-dialog') as EdithaDialog;
  }
  private get side(): EdithaSidePane | null {
    // Chiamato anche dal costruttore, prima del primo render.
    return (this.renderRoot?.querySelector('editha-side-pane') ?? null) as EdithaSidePane | null;
  }

  /** Colonna su cui agiscono barra e scorciatoie: quella usata per ultima. */
  private get editor(): EdithaEditorPane {
    const side = this.side;
    return this.split && this.sideFocused && side?.shown ? side : this.pane;
  }

  /** Tab della colonna in uso. */
  private focusedTab(): EditorTab | null {
    if (this.previewShown) return null;
    const side = this.side;
    return this.split && this.sideFocused && side?.shown ? side.shown : this.tabs.active;
  }

  private get menu(): EdithaContextMenu {
    return this.renderRoot.querySelector('editha-context-menu') as EdithaContextMenu;
  }
  private get toasts(): EdithaToasts {
    return this.renderRoot.querySelector('editha-toasts') as EdithaToasts;
  }

  // ——— ciclo di vita ———

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keydown', this.onEscape);
    window.addEventListener('beforeunload', this.onBeforeUnload);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('pageshow', this.onPageShow);
    connection.addEventListener('change', this.onConnection);
    this.offLang = onLangChange(() => this.onLanguageChanged());
    this.narrowQuery.addEventListener('change', this.onNarrowChange);
    this.toggleAttribute('narrow', this.narrow);
  }

  override disconnectedCallback(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keydown', this.onEscape);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('pageshow', this.onPageShow);
    connection.removeEventListener('change', this.onConnection);
    this.offLang?.();
    clearInterval(this.healthTimer);
    clearInterval(this.aliveTimer);
    clearTimeout(this.draftCheckTimer);
    this.narrowQuery.removeEventListener('change', this.onNarrowChange);
    super.disconnectedCallback();
  }

  override async firstUpdated(): Promise<void> {
    this.build = await api.health().then((h) => h.build, () => null);
    try {
      this.settings = await api.settings();
    } catch {
      this.toasts.show(t('settings.unavailable'), 'warning');
    }
    this.applyTheme(this.settings.theme);
    setLang(resolveLang(this.settings.language));
    this.side!.makeState = (tab) => this.mirrorState(tab);
    this.refreshToolbar();
    this.sendAlive();
    this.aliveTimer = setInterval(this.sendAlive, 20_000);
    await this.recoverDrafts();
    void haData.start();
    void this.loadSnippets();
  }

  // ——— lingua ———

  private async languageMenu(rect?: DOMRect): Promise<void> {
    const current = this.settings.language;
    const items: MenuEntry[] = (['auto', 'it', 'en'] as const).map((id) => ({
      id,
      label: t(`language.${id}`),
      ...(id === current ? { icon: icons.ok } : {}),
    }));
    // Su telefono il pulsante "Informazioni" non sta nella barra: si raggiunge da qui.
    if (this.narrow) items.push('separator', { id: 'about', label: t('toolbar.about'), icon: icons.about });
    const choice = (await this.menu.show(items, rect ? rect.left - 120 : 16, rect ? rect.bottom + 4 : 56)) as
      | LanguageSetting
      | 'about'
      | null;
    if (choice === 'about') return (this.renderRoot.querySelector('editha-about-dialog') as EdithaAboutDialog).show();
    if (!choice || choice === current) return;
    setLang(resolveLang(choice));
    await this.updateSettings({ language: choice });
  }

  /** Nuova lingua: si ridisegnano tutti i componenti e si traducono i pannelli dell'editor. */
  private onLanguageChanged(): void {
    const redraw = (root: Element | ShadowRoot) => {
      for (const el of root.querySelectorAll('*')) {
        if (el instanceof LitElement) {
          el.requestUpdate();
          if (el.shadowRoot) redraw(el.shadowRoot);
        }
      }
    };
    this.requestUpdate();
    if (this.shadowRoot) redraw(this.shadowRoot);
    // Anche il controllo YAML va rifatto: i suoi messaggi sono nella lingua scelta.
    for (const tab of this.tabs.tabs) this.applyEffects(tab, reconfigureEffects({ phrases: true, path: tab.path }));
    this.refreshStatus();
    this.refreshToolbar();
  }

  // ——— connessione con il server ———

  private readonly onConnection = () => {
    if (!connection.online) {
      this.offline = true;
      clearInterval(this.healthTimer);
      // Si riprova da soli: quando il server torna, il banner sparisce.
      this.healthTimer = setInterval(() => void this.checkHealth(), 4000);
    }
  };

  private async checkHealth(): Promise<void> {
    let build: string;
    try {
      build = (await api.health()).build;
    } catch {
      return;
    }
    clearInterval(this.healthTimer);
    // Le bozze che non sono partite mentre Editha non rispondeva si scrivono adesso.
    void this.writeAllDrafts();
    if (this.build && build !== this.build) {
      this.addonUpdated = true;
      return;
    }
    this.offline = false;
    this.toasts.show(t('conn.restored'), 'success');
  }

  /** Ricarica dal banner: prima le bozze; senza server le modifiche andrebbero perse, e lo si dice. */
  private async reloadPage(): Promise<void> {
    if (this.tabs.tabs.some((tab) => tab.dirty)) {
      if (this.offline && !this.addonUpdated) {
        const ok = await this.dialog.confirm({
          title: t('conn.reload'),
          message: t('conn.reloadOffline'),
          confirmLabel: t('conn.reload'),
          danger: true,
        });
        if (!ok) return;
      } else {
        await this.writeAllDrafts();
      }
    }
    location.reload();
  }

  private renderBanner() {
    if (!this.offline && !this.addonUpdated) return null;
    const text = this.addonUpdated
      ? t('conn.updated')
      : t('conn.offline');
    return html`<div class="banner ${this.addonUpdated ? 'info' : ''}" role="alert">
      <span>${text}</span>
      <button class="btn primary" @click=${() => void this.reloadPage()}>${t('conn.reload')}</button>
    </div>`;
  }

  private readonly onNarrowChange = (e: MediaQueryListEvent) => {
    this.narrow = e.matches;
    this.drawerOpen = false;
    if (this.narrow) this.closeSplit();
    this.toggleAttribute('narrow', this.narrow);
    // Lo schema non si aggiorna su schermo stretto: tornando larghi si ricalcola.
    this.outlineDoc = null;
    this.refreshStatus();
  };

  // ——— impostazioni ———

  private applyTheme(theme: ThemeMode): void {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }

  private async updateSettings(changes: Partial<Settings>): Promise<void> {
    this.settings = { ...this.settings, ...changes };
    this.refreshToolbar();
    try {
      this.settings = await api.updateSettings(changes);
    } catch (err) {
      this.toasts.show(t('settings.notSaved', { error: this.errorText(err) }), 'error');
    }
  }

  private async cycleTheme(): Promise<void> {
    const order: ThemeMode[] = ['auto', 'light', 'dark'];
    const next = order[(order.indexOf(this.settings.theme) + 1) % order.length]!;
    this.applyTheme(next);
    await this.updateSettings({ theme: next });
    this.toasts.show(t('theme.toast', { name: t(`theme.${next}`) }), 'info');
  }

  private async toggleWordWrap(): Promise<void> {
    await this.updateSettings({ wordWrap: !this.settings.wordWrap });
    const prefs = { wordWrap: this.settings.wordWrap, fontSize: this.settings.fontSize };
    for (const tab of this.tabs.tabs) this.applyEffects(tab, reconfigureEffects({ prefs }));
  }

  private toggleSidebar(): void {
    if (this.narrow) {
      this.drawerOpen = !this.drawerOpen;
      return;
    }
    void this.updateSettings({ sidebarVisible: !this.settings.sidebarVisible });
  }

  // ——— sessione (ED-11, FEP #13) ———

  private async restoreSession(): Promise<void> {
    let session: Session;
    try {
      session = await api.session();
    } catch {
      // Sessione non letta: non la si sovrascrive con una vuota (sessionReady resta false).
      return;
    }
    const missing: string[] = [];
    for (const saved of session.tabs) {
      let failure: unknown = null;
      const tab = await this.loadTab(saved.path, { anchor: saved.anchor, head: saved.head }, true, (err) => (failure = err));
      if (tab) this.pane.setScrollTop(tab, saved.scrollTop);
      else {
        missing.push(saved.path);
        // Un errore passeggero (Editha non risponde) non toglie il file dalla sessione.
        if (!(failure instanceof ApiError && PERMANENT_OPEN_ERRORS.has(failure.code))) this.unrestored.push(saved);
      }
    }
    const active = (session.active && this.tabs.find(session.active)) || this.tabs.tabs[0];
    if (active) this.activate(active.path);
    const side = session.side ? this.tabs.find(session.side) : undefined;
    if (side && !this.narrow) await this.showInSide(side);
    if (missing.length) {
      this.toasts.show(
        missing.length === 1
          ? t('session.missingOne', { name: missing[0]! })
          : t('session.missingMany', { n: missing.length }),
        'warning',
      );
    }
    this.sessionReady = true;
    this.scheduleSession();
  }

  private scheduleSession(): void {
    if (!this.sessionReady) return;
    clearTimeout(this.sessionTimer);
    this.sessionTimer = setTimeout(() => void this.saveSession(), 600);
  }

  /** Tab della sessione che all'avvio non si sono aperte per un errore passeggero. */
  private unrestored: Session['tabs'] = [];

  private async saveSession(): Promise<void> {
    const open = this.tabs.tabs.map((tab) => {
      const sel = this.pane.stateOf(tab).selection.main;
      return { path: tab.path, anchor: sel.anchor, head: sel.head, scrollTop: this.pane.scrollTopOf(tab) };
    });
    const kept = this.unrestored.filter((u) => !this.tabs.find(u.path));
    const session: Session = {
      tabs: [...open, ...kept].slice(0, 50),
      active: this.tabs.active?.path ?? null,
      side: this.split ? (this.side?.shown?.path ?? null) : null,
    };
    try {
      await api.saveSession(session);
    } catch {
      // La sessione è una comodità: un errore qui non va segnalato a ogni modifica.
    }
  }

  // ——— tab ———

  /** Legge un file e crea la sua tab (senza attivarla se `background`). */
  private async loadTab(
    path: string,
    selection?: { anchor: number; head: number },
    background = false,
    onError?: (err: unknown) => void,
  ): Promise<EditorTab | null> {
    const existing = this.tabs.find(path);
    if (existing) return existing;
    let file;
    try {
      file = await api.read(path);
    } catch (err) {
      if (!background) this.toasts.show(this.openErrorText(path, err), 'error');
      onError?.(err);
      return null;
    }
    const tab: EditorTab = {
      path: file.path,
      name: basename(file.path),
      etag: file.etag,
      readOnly: file.readOnly,
      dirty: false,
      state: null as unknown as EditorState,
    };
    tab.state = createEditorState({
      doc: file.content,
      path: file.path,
      readOnly: file.readOnly,
      prefs: { wordWrap: this.settings.wordWrap, fontSize: this.settings.fontSize },
      ...(selection ? { selection } : {}),
      onUpdate: (update) => this.onEditorUpdate(tab, update),
    });
    this.saved.set(tab, tab.state.doc);
    // Se nel frattempo lo stesso file è stato aperto da un'altra parte, vale la tab già in elenco.
    // Mai attivata qui: chi apre la mostra con activate(), se è ancora quella richiesta.
    const listed = background ? this.tabs.append(tab) : this.tabs.insert(tab);
    this.refreshTabs();
    return listed;
  }

  private openSeq = 0;

  async openFile(path: string, asText = false): Promise<void> {
    if (!asText && previewKind(path) && !this.tabs.find(path)) {
      this.openSeq++;
      this.openPreview(path);
      return;
    }
    // Due clic rapidi su A e poi B: vince B anche se A arriva dopo.
    const seq = ++this.openSeq;
    const tab = await this.loadTab(path);
    if (!tab || seq !== this.openSeq) return;
    this.activate(tab.path);
    if (this.narrow) this.drawerOpen = false;
    // Su touch il focus aprirebbe la tastiera a ogni file aperto.
    if (!this.touchQuery.matches) this.pane.focusEditor();
  }

  private activate(path: string): void {
    const tab = this.tabs.activate(path);
    if (!tab) return;
    // Scegliendo una tab si torna all'editor; la tab di anteprima resta.
    this.previewShown = false;
    this.pane.show(tab);
    this.refreshTabs();
    this.refreshStatus();
    this.scheduleSession();
  }

  /** Chiude una tab chiedendo cosa fare delle modifiche non salvate (ED-6, FEP #10). */
  async closeTab(path: string, opts: { force?: boolean } = {}): Promise<boolean> {
    const tab = this.tabs.find(path);
    if (!tab) return true;
    const before = this.tabs.active;
    if (tab.dirty && !opts.force) {
      if (this.tabs.active !== tab) this.activate(tab.path);
      const choice = await this.dialog.choose({
        title: t('close.title'),
        message: t('close.message', { name: tab.name }),
        choices: [
          { id: 'cancel', label: t('common.cancel') },
          { id: 'discard', label: t('close.discard') },
          { id: 'save', label: t('common.save'), variant: 'primary' },
        ],
        defaultId: 'save',
      });
      if (choice === null) return false;
      // Salvato, ma intanto si è scritto ancora: la tab resta aperta con le nuove modifiche.
      if (choice === 'save' && (!(await this.save(tab)) || tab.dirty)) return false;
    }
    // Lo stato della tab chiusa viene staccato dalla vista prima di scegliere la successiva:
    // l'editor mostra sempre il contenuto della nuova tab attiva (ED-4, FEP #19).
    this.pane.detach(tab);
    if (this.side?.shown === tab) {
      this.side.detach(tab);
      this.side.showEmpty();
    }
    this.dropDraft(tab.path, tab);
    let next = this.tabs.close(tab.path);
    // Chiudendo una tab diversa da quella attiva, resta attiva quella di prima
    // (la domanda sulle modifiche l'aveva portata in primo piano solo per mostrarla).
    if (before && before !== tab && this.tabs.find(before.path) === before) next = this.tabs.activate(before.path);
    if (next) this.pane.show(next);
    else this.pane.showEmpty();
    // Chiuse tutte le tab di testo, resta in primo piano l'anteprima, se c'è.
    if (!next && this.preview) this.showPreview();
    this.refreshTabs();
    this.refreshStatus();
    this.scheduleSession();
    return true;
  }

  private onEditorUpdate(tab: EditorTab, update: ViewUpdate): void {
    if (update.focusChanged) {
      this.editorFocused = update.view.hasFocus;
      if (update.view.hasFocus) this.sideFocused = false;
      this.refreshToolbar(update.state);
    }
    // Stessa tab nella colonna destra: le modifiche la raggiungono (ED-17).
    if (update.docChanged && this.split && !update.transactions.some((tr) => tr.annotation(fromOtherPane))) {
      this.side?.applyRemote(tab, update.changes);
    }
    if (update.docChanged) {
      const saved = this.saved.get(tab);
      const dirty = !saved || !update.state.doc.eq(saved);
      if (dirty !== tab.dirty) {
        tab.dirty = dirty;
        this.refreshTabs();
      }
      // Dell'utente ogni modifica che Editha non ha fatto da sé (anche quelle scritte nella colonna destra).
      this.scheduleDraft(tab, 1000, update.transactions.some((tr) => tr.docChanged && !tr.annotation(programmatic)));
    }
    if (tab !== this.tabs.active) return;
    this.refreshStatus(update.state);
    this.refreshToolbar(update.state);
    if (update.selectionSet || update.docChanged) this.scheduleSession();
  }

  // ——— ricerca in tutti i file (SR-1, SR-2, SR-4) ———

  private get searchPanel(): EdithaSearchPanel {
    return this.renderRoot.querySelector('editha-search-panel') as EdithaSearchPanel;
  }

  /**
   * Apre la ricerca nella barra laterale. Senza richiesta parte dal testo selezionato,
   * o dall'entity_id sotto il cursore (in quel caso cerca dove è usata l'entità).
   */
  private async openSearch(req?: SearchRequest): Promise<void> {
    if (this.narrow) this.drawerOpen = true;
    else if (!this.settings.sidebarVisible) await this.updateSettings({ sidebarVisible: true });
    this.searchOpen = true;
    this.refreshToolbar();
    await this.updateComplete;
    if (!req && this.focusedTab()) {
      const selected = this.editor.selectedText();
      if (selected && !selected.includes('\n')) req = { query: selected };
      else {
        const word = this.editor.wordAtCursor();
        if (ENTITY_ID.test(word)) req = { query: word, wholeWord: true, caseSensitive: true };
      }
    }
    if (req) this.searchPanel.searchFor(req);
    else this.searchPanel.focusInput();
  }

  private closeSearch(): void {
    this.searchOpen = false;
    this.refreshToolbar();
  }

  /** SR-3: sostituzione nei file trovati, dopo conferma; i file con modifiche non salvate si saltano. */
  private async replaceInFiles(
    e: CustomEvent<{ paths: string[]; counts: Record<string, number>; request: SearchRequest; replacement: string; truncated: boolean }>,
  ): Promise<void> {
    const { request, replacement, counts, truncated } = e.detail;
    const dirty = e.detail.paths.filter((p) => this.tabs.find(p)?.dirty);
    const paths = e.detail.paths.filter((p) => !dirty.includes(p));
    if (paths.length === 0) {
      this.toasts.show(t('replace.allDirty'), 'warning');
      return;
    }
    const ok = await this.dialog.confirm({
      title: t('replace.confirmTitle'),
      message:
        replaceConfirmMessage({
          matches: paths.reduce((n, p) => n + (counts[p] ?? 0), 0),
          files: paths.length,
          query: request.query,
          replacement,
          truncated,
        }) + (dirty.length ? t('replace.skipDirty', { names: dirty.map((p) => basename(p)).join(', ') }) : ''),
      confirmLabel: t('replace.all'),
      danger: true,
    });
    if (!ok) return;
    let res;
    try {
      res = await api.replace(paths, request, replacement);
    } catch (err) {
      this.toasts.show(t('replace.failed', { error: this.errorText(err) }), 'error');
      return;
    }
    // Le tab aperte (senza modifiche) mostrano subito il testo nuovo.
    for (const f of res.files) {
      const tab = this.tabs.find(f.path);
      if (tab && !tab.dirty) await this.reloadFromDisk(tab, true);
    }
    const count = res.files.reduce((n, f) => n + f.count, 0);
    this.flash(replaceDoneMessage(count, res.files.length));
    if (res.skipped.length) this.toasts.show(replaceSkippedMessage(res.skipped.length), 'warning');
    await this.searchPanel.rerun();
  }

  private async openSearchResult(path: string, match: SearchMatch): Promise<void> {
    await this.openFile(path);
    if (this.tabs.active?.path === path) this.pane.selectMatch(match.line, match.column, match.length);
  }

  // ——— confronto tra due file (BK-6) ———

  /** Testo da confrontare: quello della tab aperta (anche non salvato) o quello su disco. */
  private async compareSide(path: string): Promise<CompareSide | null> {
    const tab = this.tabs.find(path);
    if (tab) return { path, content: docText(this.pane.stateOf(tab)) };
    try {
      return { path, content: (await api.read(path)).content };
    } catch (err) {
      this.toasts.show(this.openErrorText(path, err), 'error');
      return null;
    }
  }

  private async openCompare(a: string, b: string): Promise<void> {
    const left = await this.compareSide(a);
    const right = left && (await this.compareSide(b));
    if (!left || !right) return;
    if (this.narrow) this.drawerOpen = false;
    this.history = null;
    this.previewShown = false;
    this.compare = { left, right };
  }

  // ——— anteprima di immagini e PDF (FS-10) ———

  /** Apre un'immagine o un PDF nella tab di anteprima, che è una sola e viene riusata. */
  private openPreview(path: string): void {
    if (this.narrow) this.drawerOpen = false;
    this.preview = path;
    this.showPreview();
  }

  private showPreview(): void {
    this.history = null;
    this.compare = null;
    this.previewShown = true;
    this.refreshToolbar();
    this.refreshStatus();
  }

  private closePreview(): void {
    this.preview = null;
    this.previewShown = false;
    this.refreshToolbar();
    this.refreshStatus();
  }

  // ——— collegamenti: !include e !secret (HA-4, HA-5) ———

  private async followLink(e: CustomEvent<{ kind: LinkKind; target: string; file: string }>): Promise<void> {
    const { kind, target, file } = e.detail;
    if (kind === 'secret') {
      const key = (await secretKeys(file)).find((k) => k.key === target);
      if (!key) {
        this.toasts.show(t('link.secretMissing', { key: target }), 'warning');
        return;
      }
      await this.openFile(key.path);
      if (this.tabs.active?.path === key.path) this.pane.goToLine(key.line);
      return;
    }
    // Come in HA, il percorso è relativo alla cartella del file che contiene l'include.
    const path = resolvePath(dirname(file), target);
    // '' è /config stessa: va bene solo per una cartella (!include_dir_… ..), non per un file.
    if (path === null || (path === '' && kind === 'include')) {
      this.toasts.show(t('link.outside', { path: target }), 'warning');
      return;
    }
    if (kind === 'include') {
      await this.openFile(path);
      return;
    }
    // !include_dir_…: si mostra la cartella nell'albero.
    if (this.narrow) this.drawerOpen = true;
    else if (!this.settings.sidebarVisible) await this.updateSettings({ sidebarVisible: true });
    await this.updateComplete;
    if (path === '') return;
    if (!(await this.tree.reveal(path, 'directory', true))) this.toasts.show(t('link.dirMissing', { path }), 'warning');
  }

  // ——— vista divisa (ED-17) ———

  /** Stato della colonna destra per una tab: stesso testo, cursore e annulla propri. */
  private mirrorState(tab: EditorTab): EditorState {
    const canonical = this.pane.stateOf(tab);
    const sel = canonical.selection.main;
    return createEditorState({
      doc: docText(canonical),
      path: tab.path,
      readOnly: tab.readOnly,
      prefs: { wordWrap: this.settings.wordWrap, fontSize: this.settings.fontSize },
      selection: { anchor: sel.anchor, head: sel.head },
      onUpdate: (update) => this.onSideUpdate(update),
    });
  }

  private onSideUpdate(update: ViewUpdate): void {
    if (update.focusChanged && update.view.hasFocus) this.sideFocused = true;
    // Ogni aggiornamento conta: anche i risultati del controllo YAML arrivano così, dopo una pausa.
    if (this.sideFocused) {
      this.refreshStatus();
      this.refreshToolbar();
    }
  }

  /** Modifica fatta a destra: arriva alla tab (che è ciò che si salva) e alla colonna sinistra. */
  private onSideChange(e: CustomEvent<{ tab: EditorTab; changes: ChangeSet }>): void {
    const { tab, changes } = e.detail;
    if (this.tabs.find(tab.path) !== tab) return;
    if (this.pane.applyRemote(tab, changes)) return;
    // La tab non è visibile a sinistra: niente ascoltatori, si aggiorna qui.
    const saved = this.saved.get(tab);
    const dirty = !saved || !tab.state.doc.eq(saved);
    if (dirty !== tab.dirty) {
      tab.dirty = dirty;
      this.refreshTabs();
    }
    this.scheduleDraft(tab, 1000, true);
  }

  private async showInSide(tab: EditorTab): Promise<void> {
    if (this.narrow) return;
    this.split = true;
    // L'anteprima coprirebbe la colonna appena aperta.
    this.previewShown = false;
    await this.updateComplete;
    this.side?.show(tab);
    this.sideFocused = true;
    this.side?.focusEditor();
    this.refreshTabs();
    this.refreshStatus();
    this.scheduleSession();
  }

  private async openInSide(path: string): Promise<void> {
    const tab = await this.loadTab(path, undefined, true, (err) =>
      this.toasts.show(this.openErrorText(path, err), 'error'),
    );
    if (tab) await this.showInSide(tab);
  }

  private closeSplit(): void {
    if (!this.split) return;
    const side = this.side;
    const shown = side?.shown;
    if (side && shown) side.detach(shown);
    side?.showEmpty();
    this.split = false;
    this.sideFocused = false;
    this.refreshTabs();
    this.refreshStatus();
    this.scheduleSession();
    if (!this.touchQuery.matches) this.pane.focusEditor();
  }

  /** Effetti di configurazione per la tab e, se la mostra, per la colonna destra. */
  private applyEffects(tab: EditorTab, effects: StateEffect<unknown>[]): void {
    this.pane.apply(tab, effects);
    this.side?.apply(tab, effects);
  }

  /** Testo sostituito (ricarica, bozza recuperata): anche la colonna destra si riallinea. */
  private replaceDoc(tab: EditorTab, text: string): void {
    const visible = this.pane.shown === tab;
    const changes = this.pane.replaceDoc(tab, text);
    if (!visible && changes && !this.side?.replaceFromOutside(tab, changes)) this.side?.resync(tab);
  }

  private renderSide() {
    const shown = this.side?.shown ?? null;
    return html`<div class="side ${this.sideFocused ? 'focused' : ''}" ?hidden=${!this.split}>
      <div class="side-head">
        <select
          aria-label=${t('split.choose')}
          .value=${shown?.path ?? ''}
          @change=${(e: Event) => {
            const tab = this.tabs.find((e.target as HTMLSelectElement).value);
            if (tab) void this.showInSide(tab);
          }}
        >
          ${shown ? null : html`<option value="" selected>${t('split.choose')}</option>`}
          ${this.tabViews.map(
            (v) => html`<option value=${v.path} ?selected=${v.path === shown?.path}>${v.dirty ? '● ' : ''}${v.path}</option>`,
          )}
        </select>
        <button class="icon-btn small" title=${t('split.close')} @click=${() => this.closeSplit()}>
          ${icon(icons.close, 16)}
        </button>
      </div>
      <editha-side-pane @side-change=${this.onSideChange}>
        <div class="side-empty" slot="empty">${t('split.empty')}</div>
      </editha-side-pane>
    </div>`;
  }

  // ——— salvataggio (ED-5, SEC-4) ———

  /** Salvataggi in corso: uno alla volta per tab, ognuno parte dall'etag del precedente. */
  private readonly saving = new Map<EditorTab, Promise<boolean>>();

  async save(tab: EditorTab | null = this.focusedTab()): Promise<boolean> {
    if (!tab || tab.readOnly) return false;
    // Niente da salvare: Ctrl+S su una tab pulita non deve proporre di sovrascrivere il file.
    if (!tab.dirty && !this.saving.has(tab)) return true;
    // Un secondo Ctrl+S mentre il primo è in viaggio aspetta: altrimenti partirebbe con
    // l'etag vecchio e il server lo scambierebbe per un conflitto.
    const previous = this.saving.get(tab) ?? Promise.resolve(true);
    const run = previous.then(
      () => this.saveNow(tab),
      () => this.saveNow(tab),
    );
    this.saving.set(tab, run);
    try {
      return await run;
    } finally {
      if (this.saving.get(tab) === run) this.saving.delete(tab);
    }
  }

  private async saveNow(tab: EditorTab): Promise<boolean> {
    if (this.tabs.find(tab.path) !== tab) return false;
    const state = this.pane.stateOf(tab);
    const doc = state.doc;
    try {
      const res = await api.save(tab.path, docText(state), tab.etag);
      this.markSaved(tab, doc, res.etag);
      if (tab.name === 'secrets.yaml') forgetSecrets();
      this.flash(t('save.done', { name: tab.name }));
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === 'conflict') return this.resolveConflict(tab, err);
      if (err instanceof ApiError && err.code === 'not_found') return this.recreateOnSave(tab, state);
      this.toasts.show(t('save.failed', { name: tab.name, error: this.errorText(err) }), 'error');
      return false;
    }
  }

  /** Il file è stato rinominato o eliminato da un'altra parte mentre era aperto qui. */
  private async recreateOnSave(tab: EditorTab, state: EditorState): Promise<boolean> {
    const choice = await this.dialog.choose({
      title: t('save.missingTitle'),
      message: t('save.missing', { name: tab.path }),
      choices: [
        { id: 'cancel', label: t('common.cancel') },
        { id: 'recreate', label: t('drafts.recreate'), variant: 'primary' },
      ],
      defaultId: 'recreate',
    });
    if (choice !== 'recreate') return false;
    try {
      await api.create(tab.path, 'file', docText(state));
      const file = await api.read(tab.path);
      this.markSaved(tab, state.doc, file.etag);
    } catch (err) {
      this.toasts.show(t('save.failed', { name: tab.name, error: this.errorText(err) }), 'error');
      return false;
    }
    await this.tree.refresh(dirname(tab.path));
    this.flash(t('save.done', { name: tab.name }));
    return true;
  }

  private markSaved(tab: EditorTab, doc: Text, etag: string): void {
    tab.etag = etag;
    this.saved.set(tab, doc);
    tab.dirty = !this.pane.stateOf(tab).doc.eq(doc);
    this.refreshTabs();
    // Salvato quello che c'era nella bozza: se nel frattempo si è scritto ancora, la bozza si aggiorna.
    if (tab.dirty) this.scheduleDraft(tab);
    else {
      this.dropDraft(tab.path, tab);
      // Salvato: la prossima modifica richiede cosa fare della bozza vecchia ancora in sospeso.
      const deferred = this.deferredDrafts.get(tab.path);
      if (deferred) deferred.asked = false;
    }
  }

  // ——— bozze delle modifiche non salvate (ED-14) ———

  /** Entro quando la bozza va scritta anche se si continua a scrivere senza pause. */
  private readonly draftDue = new Map<EditorTab, number>();
  /**
   * Bozze della volta precedente non ancora recuperate o scartate: finché l'utente non ha
   * scelto, una modifica allo stesso file non deve sostituirle sul server.
   */
  private pendingDrafts = new Set<string>();

  /**
   * Bozze lasciate in sospeso con Esc all'avvio: restano sul server per la prossima volta, e la
   * prima modifica allo stesso file chiede cosa farne invece di sostituirle (`asked`: già chiesto).
   */
  private readonly deferredDrafts = new Map<string, { draft: Draft; asked: boolean }>();

  /** `byUser`: modifica scritta dall'utente (non una ricarica dal disco o un ripristino). */
  private scheduleDraft(tab: EditorTab, delay = 1000, byUser = false): void {
    if (tab.readOnly) return;
    const deferred = this.deferredDrafts.get(tab.path);
    if (deferred) {
      if (byUser && !deferred.asked) void this.askDeferredDraft(tab, deferred);
      return;
    }
    clearTimeout(this.draftTimers.get(tab));
    const now = Date.now();
    const due = this.draftDue.get(tab) ?? now + 5000;
    this.draftDue.set(tab, due);
    this.draftTimers.set(
      tab,
      setTimeout(() => void this.writeDraft(tab), Math.max(0, Math.min(delay, due - now))),
    );
  }

  private async writeDraft(tab: EditorTab): Promise<void> {
    clearTimeout(this.draftTimers.get(tab));
    this.draftTimers.delete(tab);
    this.draftDue.delete(tab);
    if (this.tabs.find(tab.path) !== tab) return;
    if (!tab.dirty) return this.dropDraft(tab.path, tab);
    const path = tab.path;
    if (this.deferredDrafts.has(path)) return;
    if (this.pendingDrafts.has(path)) return this.scheduleDraft(tab);
    const gen = this.draftGen.get(tab) ?? 0;
    try {
      await api.saveDraft(path, docText(this.pane.stateOf(tab)), tab.etag);
      // Salvata, scartata o rinominata nel frattempo: questa bozza non serve più.
      if ((this.draftGen.get(tab) ?? 0) !== gen || tab.path !== path) {
        api.deleteDraft(path).catch(() => undefined);
        // Rinominata: la bozza va riscritta sotto il nuovo nome.
        if (tab.path !== path && tab.dirty && this.tabs.find(tab.path) === tab) this.scheduleDraft(tab);
        return;
      }
      this.drafted.add(path);
    } catch (err) {
      // Editha non risponde (aggiornamento, riavvio): si riprova, e intanto il timer in attesa
      // fa sì che chiudendo la pagina la bozza parta comunque.
      if (err instanceof ApiError && err.code === 'offline' && tab.dirty && this.tabs.find(tab.path) === tab) {
        this.scheduleDraft(tab, 5000);
      }
    }
  }

  /** Si modifica un file con una bozza rimasta in sospeso: recuperarla o scartarla, adesso. */
  private async askDeferredDraft(tab: EditorTab, deferred: { draft: Draft; asked: boolean }): Promise<void> {
    deferred.asked = true;
    const { draft } = deferred;
    const choice = await this.dialog.choose({
      title: t('drafts.title'),
      message: t('drafts.deferred', { name: draft.path, date: formatVersionDate(draft.savedAt) }),
      choices: [
        { id: 'discard', label: t('drafts.discardOld'), variant: 'danger' },
        { id: 'recover', label: t('drafts.recover'), variant: 'primary' },
      ],
      defaultId: 'recover',
      whileTyping: true,
    });
    if (choice === null) {
      // Ancora "dopo": la bozza vecchia resta, ma le modifiche nuove di questo file non hanno bozza.
      this.toasts.show(t('drafts.deferredKept', { name: tab.name }), 'warning');
      return;
    }
    if (choice === 'recover' && this.tabs.find(draft.path) !== tab) {
      // La tab nel frattempo non c'è più: la bozza resta in sospeso.
      deferred.asked = false;
      return;
    }
    this.deferredDrafts.delete(draft.path);
    if (choice === 'discard') {
      await this.discardDraft(draft);
      if (tab.dirty) this.scheduleDraft(tab);
      return;
    }
    // Recupera: il testo appena scritto torna indietro con Annulla.
    const mine = await this.claimDraft(draft);
    if (!mine) {
      if (tab.dirty) this.scheduleDraft(tab);
      return;
    }
    const diskEtag = tab.etag;
    this.replaceDoc(tab, mine.content);
    tab.etag = mine.etag;
    if (diskEtag !== mine.etag) this.toasts.show(t('drafts.changedOnDisk', { name: tab.name }), 'warning');
    const saved = this.saved.get(tab);
    tab.dirty = !saved || !this.pane.stateOf(tab).doc.eq(saved);
    this.drafted.add(tab.path);
    this.refreshTabs();
    if (this.tabs.active !== tab && this.side?.shown !== tab) this.activate(tab.path);
    this.flash(t('drafts.recovered'));
  }

  /** Scrive subito la bozza di ogni tab modificata (prima di ricaricare la pagina, al ritorno del server). */
  private writeAllDrafts(): Promise<void[]> {
    return Promise.all(this.tabs.tabs.filter((t) => t.dirty && !t.readOnly).map((t) => this.writeDraft(t)));
  }

  private dropDraft(path: string, tab?: EditorTab): void {
    if (tab) {
      clearTimeout(this.draftTimers.get(tab));
      this.draftTimers.delete(tab);
      this.draftDue.delete(tab);
      this.draftGen.set(tab, (this.draftGen.get(tab) ?? 0) + 1);
    }
    if (!this.drafted.delete(path)) return;
    api.deleteDraft(path).catch(() => this.drafted.add(path));
  }

  /** Uscendo dalla pagina (o passando a un'altra app) le bozze in attesa si scrivono subito. */
  private flushDrafts(): void {
    for (const tab of [...this.draftTimers.keys()]) void this.writeDraft(tab);
  }

  private readonly onVisibility = () => {
    if (document.visibilityState === 'hidden') whileLeaving(() => this.flushDrafts());
    else {
      // Al ritorno (telefono sbloccato, scheda riaperta): si torna "vivi", e le bozze si
      // riscrivono, nel caso un'altra finestra le avesse scartate credendo questa chiusa.
      this.sendAlive();
      void this.writeAllDrafts();
      void this.checkOrphanDrafts();
    }
  };

  /**
   * Alla riapertura: modifiche rimaste in sospeso. La domanda arriva prima di riaprire le tab
   * della sessione, così non si fa in tempo a modificare un file che ha una bozza da recuperare.
   */
  private async recoverDrafts(): Promise<void> {
    let list: ListedDraft[] = [];
    try {
      list = (await api.drafts()).drafts;
    } catch {
      // Senza elenco si prosegue: le bozze restano sul server per la prossima apertura.
    }
    const drafts = this.orphanDrafts(list);
    this.pendingDrafts = new Set(drafts.map((d) => d.path));
    let choice: string | null = null;
    try {
      if (drafts.length) {
        const names = drafts.map((d) => `• ${d.path} (${formatVersionDate(d.savedAt)})`).join('\n');
        choice = await this.dialog.choose({
          title: t('drafts.title'),
          message: drafts.length === 1 ? t('drafts.messageOne') : t('drafts.messageMany', { n: drafts.length }),
          detail: names,
          choices: [
            { id: 'discard', label: t('drafts.discard'), variant: 'danger' },
            { id: 'recover', label: t('drafts.recover'), variant: 'primary' },
          ],
          defaultId: 'recover',
        });
      }
      // Esc: le bozze restano per la prossima apertura; modificando uno di quei file si chiede.
      if (choice === null) for (const draft of drafts) this.deferredDrafts.set(draft.path, { draft, asked: false });
      await this.restoreSession();
      if (choice === 'discard') {
        await Promise.all(drafts.map((d) => this.discardDraft(d)));
      } else if (choice === 'recover') {
        await this.applyDrafts(drafts);
      }
    } finally {
      this.pendingDrafts = new Set();
      this.scheduleDraftCheck(list);
    }
  }

  // ——— bozze e più finestre aperte ———

  /** Bozze di altre finestre già viste in questa pagina (proposte o lasciate in sospeso). */
  private readonly seenDrafts = new Set<string>();
  private draftCheckTimer: ReturnType<typeof setTimeout> | undefined;

  private static draftKey(d: Draft): string {
    return `${d.client ?? ''}\0${d.path}`;
  }

  /**
   * Bozze da proporre qui: quelle lasciate da questa stessa finestra (prima di ricaricarla) e
   * quelle di finestre ormai chiuse. Le bozze di una finestra ancora aperta sono sue, non si
   * toccano. Una per file, la più recente; tutte risultano viste.
   */
  private orphanDrafts(list: ListedDraft[]): ListedDraft[] {
    const byPath = new Map<string, ListedDraft>();
    for (const d of list) {
      if (d.live && d.client !== CLIENT_ID) continue;
      const key = EdithaApp.draftKey(d);
      if (this.seenDrafts.has(key)) continue;
      this.seenDrafts.add(key);
      if (!byPath.has(d.path)) byPath.set(d.path, d);
      else {
        // Più vecchie della bozza proposta per lo stesso file: seguono la sua sorte.
        const older = this.supersededDrafts.get(d.path) ?? [];
        older.push(d);
        this.supersededDrafts.set(d.path, older);
      }
    }
    return [...byPath.values()];
  }

  /** Bozze più vecchie di quella proposta per lo stesso file. */
  private readonly supersededDrafts = new Map<string, Draft[]>();

  /** Una bozza proposta è stata scartata o fatta propria: via anche quelle più vecchie dello stesso file. */
  private async dropSuperseded(path: string, keepOwn = false): Promise<void> {
    const older = this.supersededDrafts.get(path);
    if (!older) return;
    this.supersededDrafts.delete(path);
    // Recuperando, la bozza di questa finestra è appena stata riscritta: non va tolta.
    const drop = keepOwn ? older.filter((d) => d.client !== CLIENT_ID) : older;
    await Promise.all(drop.map((d) => api.deleteDraft(d.path, d.client ?? null).catch(() => undefined)));
  }

  /** Scarta una bozza proposta (di questa o di un'altra finestra) e quelle più vecchie dello stesso file. */
  private async discardDraft(draft: Draft): Promise<void> {
    await api.deleteDraft(draft.path, draft.client ?? null).catch(() => undefined);
    await this.dropSuperseded(draft.path);
  }

  /**
   * Bozze di finestre ancora aperte: si ricontrolla quando la prima potrebbe risultare chiusa
   * (una finestra chiusa di colpo, per esempio dal telefono, non lo dice al server).
   */
  private scheduleDraftCheck(list: ListedDraft[]): void {
    clearTimeout(this.draftCheckTimer);
    const others = list.filter((d) => d.live && d.client !== CLIENT_ID && !this.seenDrafts.has(EdithaApp.draftKey(d)));
    if (others.length === 0) return;
    const wait = Math.min(...others.map((d) => DRAFT_LIVE_MS - (d.idleMs ?? 0))) + 3000;
    this.draftCheckTimer = setTimeout(() => void this.checkOrphanDrafts(), Math.min(Math.max(wait, 5000), 120_000));
  }

  /** Durante il lavoro: bozze lasciate da una finestra che nel frattempo si è chiusa. */
  private async checkOrphanDrafts(): Promise<void> {
    // Un'altra finestra di dialogo aperta verrebbe annullata: si riprova tra poco.
    // Una finestra nascosta non chiede niente: lo farà tornando in primo piano (onVisibility).
    if (document.hidden) return;
    if (this.dialog.busy) {
      clearTimeout(this.draftCheckTimer);
      this.draftCheckTimer = setTimeout(() => void this.checkOrphanDrafts(), 10_000);
      return;
    }
    let list: ListedDraft[];
    try {
      list = (await api.drafts()).drafts;
    } catch {
      clearTimeout(this.draftCheckTimer);
      this.draftCheckTimer = setTimeout(() => void this.checkOrphanDrafts(), 30_000);
      return;
    }
    // Intanto si è aperta un'altra finestra di dialogo, o la pagina è passata in secondo piano.
    if (this.dialog.busy || document.hidden) {
      clearTimeout(this.draftCheckTimer);
      this.draftCheckTimer = setTimeout(() => void this.checkOrphanDrafts(), 10_000);
      return;
    }
    // Un file con modifiche di questa finestra non riceve la bozza di un'altra a metà lavoro:
    // la si propone alla prossima apertura.
    const mine = (path: string) => this.drafted.has(path) || this.deferredDrafts.has(path) || !!this.tabs.find(path)?.dirty;
    const drafts = this.orphanDrafts(list).filter((d) => {
      if (!mine(d.path)) return true;
      this.seenDrafts.delete(EdithaApp.draftKey(d));
      for (const old of this.supersededDrafts.get(d.path) ?? []) this.seenDrafts.delete(EdithaApp.draftKey(old));
      this.supersededDrafts.delete(d.path);
      return false;
    });
    if (drafts.length) {
      const names = drafts.map((d) => `• ${d.path} (${formatVersionDate(d.savedAt)})`).join('\n');
      const choice = await this.dialog.choose({
        title: t('drafts.title'),
        message: drafts.length === 1 ? t('drafts.otherOne') : t('drafts.otherMany', { n: drafts.length }),
        detail: names,
        choices: [
          { id: 'discard', label: t('drafts.discard'), variant: 'danger' },
          { id: 'recover', label: t('drafts.recover'), variant: 'primary' },
        ],
        defaultId: 'recover',
        whileTyping: true,
      });
      if (choice === 'discard') {
        await Promise.all(drafts.map((d) => this.discardDraft(d)));
      } else if (choice === 'recover') {
        await this.applyDrafts(drafts);
      } else {
        for (const d of drafts) if (!this.deferredDrafts.has(d.path)) this.deferredDrafts.set(d.path, { draft: d, asked: false });
      }
    }
    this.scheduleDraftCheck(list);
  }

  /**
   * Prima di recuperare la bozza di un'altra finestra (o di una versione precedente) la si prende
   * dal server: passa a questa finestra in un colpo solo, e se un'altra finestra l'ha già presa
   * non la si apre una seconda volta. Null: già presa altrove, o server non raggiungibile.
   */
  private async claimDraft(draft: Draft): Promise<Draft | null> {
    let claimed: Draft | undefined;
    if (draft.client === CLIENT_ID) claimed = draft;
    else {
      try {
        const res = await api.claimDraft(draft.path, draft.client);
        if (!res.claimed) {
          this.toasts.show(t('drafts.takenElsewhere', { name: draft.path }), 'info');
          return null;
        }
        claimed = res.draft;
      } catch {
        // Server non raggiungibile: la bozza resta dov'è, per la prossima volta.
        this.toasts.show(t('drafts.cannotOpen', { name: draft.path }), 'warning');
        return null;
      }
    }
    // Le bozze più vecchie dello stesso file seguono questa (quella di questa finestra è appena stata riscritta).
    void this.dropSuperseded(draft.path, true);
    return claimed ?? draft;
  }

  /** Questa finestra è ancora aperta: le sue bozze non vanno proposte altrove. */
  private readonly sendAlive = () => void api.draftsAlive().catch(() => undefined);
  private aliveTimer: ReturnType<typeof setInterval> | undefined;

  /** Pagina ripresa dalla cache del browser (indietro/avanti): l'identità torna solo in memoria. */
  private readonly onPageShow = () => forgetKeptClientId();

  private readonly onPageHide = () => {
    keepClientId();
    whileLeaving(() => void api.draftsAlive(true).catch(() => undefined));
  };

  private async applyDrafts(drafts: Draft[]): Promise<void> {
    let first: EditorTab | null = null;
    for (const draft of drafts) {
      // Già in sospeso per quel file: vale la domanda alla prima modifica.
      if (this.deferredDrafts.has(draft.path) && this.deferredDrafts.get(draft.path)!.draft !== draft) continue;
      let failure: unknown = null;
      let tab = await this.loadTab(draft.path, undefined, true, (err) => (failure = err));
      if (!tab && failure instanceof ApiError && failure.code === 'not_found') {
        // Il file non c'è più (rinominato o eliminato da un'altra parte): si può ricrearlo.
        tab = await this.recreateFromDraft(draft);
        if (!tab) continue;
      } else if (
        (tab !== null && tab.readOnly) ||
        (failure instanceof ApiError && PERMANENT_OPEN_ERRORS.has(failure.code))
      ) {
        // Diventato di sola lettura o non più apribile: la bozza non si potrà mai salvare, e
        // tenerla farebbe tornare la domanda a ogni apertura.
        await this.discardDraft(draft);
        this.toasts.show(t('drafts.dropped', { name: draft.path }), 'warning');
        continue;
      }
      if (!tab) {
        this.toasts.show(t('drafts.cannotOpen', { name: draft.path }), 'warning');
        continue;
      }
      if (tab.dirty) {
        // Modificato mentre si apriva la sessione: non si sovrascrive quello che si è appena scritto.
        this.toasts.show(t('drafts.skippedDirty', { name: tab.name }), 'warning');
        continue;
      }
      const diskEtag = tab.etag;
      if (docText(this.pane.stateOf(tab)) === draft.content) {
        // Uguale al file su disco: niente da recuperare.
        await this.discardDraft(draft);
        continue;
      }
      const mine = await this.claimDraft(draft);
      if (!mine) continue;
      this.replaceDoc(tab, mine.content);
      // L'etag di partenza: se il file è cambiato su disco, il salvataggio chiederà cosa fare (SEC-4).
      tab.etag = mine.etag;
      const saved = this.saved.get(tab);
      tab.dirty = !saved || !this.pane.stateOf(tab).doc.eq(saved);
      this.drafted.add(tab.path);
      if (diskEtag !== mine.etag) this.toasts.show(t('drafts.changedOnDisk', { name: tab.name }), 'warning');
      first ??= tab;
    }
    this.refreshTabs();
    if (first) {
      this.activate(first.path);
      this.flash(t('drafts.recovered'));
    }
  }

  /** Bozza di un file che non esiste più: ricrearlo con quelle modifiche, o scartarle. */
  private async recreateFromDraft(draft: Draft): Promise<EditorTab | null> {
    const choice = await this.dialog.choose({
      title: t('drafts.title'),
      message: t('drafts.missing', { name: draft.path }),
      choices: [
        { id: 'discard', label: t('drafts.discard'), variant: 'danger' },
        { id: 'recreate', label: t('drafts.recreate'), variant: 'primary' },
      ],
      defaultId: 'recreate',
    });
    if (choice === 'discard') {
      await this.discardDraft(draft);
      return null;
    }
    if (choice !== 'recreate') return null;
    const mine = await this.claimDraft(draft);
    if (!mine) return null;
    try {
      // create non sovrascrive mai: se nel frattempo il file è ricomparso, lo si dice.
      await api.create(draft.path, 'file', mine.content);
    } catch (err) {
      // La bozza (ora di questa finestra) resta per la prossima volta.
      this.toasts.show(t('drafts.recreateFailed', { name: draft.path, error: this.errorText(err) }), 'error');
      return null;
    }
    await api.deleteDraft(draft.path).catch(() => undefined);
    await this.tree.refresh(dirname(draft.path));
    const tab = await this.loadTab(draft.path, undefined, true);
    if (tab) {
      this.activate(tab.path);
      this.flash(t('drafts.recreated', { name: tab.name }));
    }
    return null;
  }

  /** Versioni eliminate: la cronologia aperta di un file ricarica il suo elenco. */
  private async afterHistoryPruned(): Promise<void> {
    const panel = this.renderRoot.querySelector('editha-history-panel') as EdithaHistoryPanel | null;
    if (panel && this.history) await panel.reload(this.history.current);
  }

  /** BK-7: spazio occupato dalla cronologia. */
  private openHistorySpace(): Promise<void> {
    return (this.renderRoot.querySelector('editha-history-space') as EdithaHistorySpace).show();
  }

  /** Il file è cambiato su disco dopo l'apertura: decide l'utente. */
  private async resolveConflict(tab: EditorTab, err: ApiError): Promise<boolean> {
    const choice = await this.dialog.choose({
      title: t('conflict.title'),
      message: t('conflict.message', { name: tab.name }),
      choices: [
        { id: 'cancel', label: t('common.cancel') },
        { id: 'reload', label: t('conflict.reload') },
        { id: 'overwrite', label: t('conflict.overwrite'), variant: 'danger' },
      ],
      defaultId: 'cancel',
    });
    if (choice === 'overwrite') {
      tab.etag = String(err.details.etag ?? tab.etag);
      // Già dentro il salvataggio in corso: si riprova direttamente, senza mettersi in coda.
      return this.saveNow(tab);
    }
    if (choice === 'reload') {
      await this.reloadFromDisk(tab);
    }
    return false;
  }

  private async reloadFromDisk(tab: EditorTab, quiet = false): Promise<void> {
    const before = this.pane.stateOf(tab).doc;
    try {
      const file = await api.read(tab.path);
      // Ricarica automatica (dopo una sostituzione, un caricamento, un ripristino): se intanto si
      // è scritto nella tab, il testo resta; al salvataggio l'etag vecchio farà chiedere cosa fare.
      if (quiet && !this.pane.stateOf(tab).doc.eq(before)) return;
      this.replaceDoc(tab, file.content);
      this.markSaved(tab, this.pane.stateOf(tab).doc, file.etag);
      if (!quiet) this.toasts.show(t('conflict.reloaded', { name: tab.name }), 'info');
    } catch (err) {
      this.toasts.show(this.openErrorText(tab.path, err), 'error');
    }
  }

  async saveAll(): Promise<void> {
    let n = 0;
    for (const tab of this.tabs.tabs.filter((t) => t.dirty && !t.readOnly)) {
      if (!(await this.save(tab))) return;
      n++;
    }
    if (n > 1) this.flash(t('save.doneMany', { n }));
  }

  // ——— operazioni sui file (FS-2, FS-3, FS-4) ———

  /** Cartella di destinazione: quella selezionata, o la cartella del file selezionato (FEP #11). */
  private targetDir(entry?: Entry | null): string {
    if (entry) return entry.type === 'directory' ? entry.path : dirname(entry.path);
    const sel = this.tree.getSelection();
    if (!sel) return '';
    return sel.type === 'directory' ? sel.path : dirname(sel.path);
  }

  private async create(type: 'file' | 'directory', dir = this.targetDir()): Promise<void> {
    const where = dir === '' ? '/config' : `/config/${dir}`;
    const name = await this.dialog.prompt({
      title: type === 'file' ? t('create.fileTitle') : t('create.folderTitle'),
      label: t('create.label', { where }),
      value: type === 'file' ? '.yaml' : '',
      selectUntil: 0,
      confirmLabel: t('common.create'),
      validate: validateName,
    });
    if (name === null) return;
    const path = join(dir, name);
    try {
      await api.create(path, type);
    } catch (err) {
      this.toasts.show(t('create.failed', { name, error: this.errorText(err) }), 'error');
      return;
    }
    await this.tree.refresh(dir);
    await this.tree.reveal(path, type);
    if (type === 'file') await this.openFile(path);
    this.flash(t('create.done', { name }));
  }

  private async rename(entry: { path: string; type: string }): Promise<void> {
    const old = basename(entry.path);
    const dot = entry.type === 'file' ? old.lastIndexOf('.') : -1;
    const name = await this.dialog.prompt({
      title: entry.type === 'directory' ? t('rename.folderTitle') : t('rename.fileTitle'),
      label: t('rename.label'),
      value: old,
      selectUntil: dot > 0 ? dot : old.length,
      confirmLabel: t('common.rename'),
      validate: (v) => validateName(v) ?? (v === old ? t('rename.same') : null),
    });
    if (name === null) return;
    const to = join(dirname(entry.path), name);
    try {
      await api.rename(entry.path, to);
    } catch (err) {
      this.toasts.show(t('rename.failed', { name: old, error: this.errorText(err) }), 'error');
      return;
    }
    await this.afterMove(entry, to);
    this.flash(t('rename.done', { name }));
  }

  /** FS-5: "Sposta in…" con la scelta della cartella di destinazione (niente trascinamento). */
  private async moveEntry(entry: { path: string; type: string }): Promise<void> {
    let folders: string[];
    try {
      folders = (await api.folders()).folders;
    } catch (err) {
      this.toasts.show(t('move.failed', { name: basename(entry.path), error: this.errorText(err) }), 'error');
      return;
    }
    const name = basename(entry.path);
    const here = dirname(entry.path);
    const picker = this.renderRoot.querySelector('editha-folder-picker') as EdithaFolderPicker;
    const dest = await picker.pick({
      title: t(entry.type === 'directory' ? 'move.folderTitle' : 'move.fileTitle', { name }),
      folders,
      // Non nella cartella dove sta già, né (per una cartella) dentro sé stessa.
      disabled: (f) => f === here || (entry.type === 'directory' && (f === entry.path || f.startsWith(entry.path + '/'))),
    });
    if (dest === null) return;
    const to = join(dest, name);
    try {
      await api.rename(entry.path, to);
    } catch (err) {
      this.toasts.show(t('move.failed', { name, error: this.errorText(err) }), 'error');
      return;
    }
    await this.afterMove(entry, to);
    await this.tree.refresh(dest);
    await this.tree.reveal(to, entry.type as 'file' | 'directory');
    this.flash(t('move.done', { name, where: dest ? `/config/${dest}` : '/config' }));
  }

  /** Dopo rinomina o spostamento: tab, bozze, albero e sessione seguono il file. */
  private async afterMove(entry: { path: string; type: string }, to: string): Promise<void> {
    // Le tab aperte seguono il file (FEP #18); se cambia l'estensione cambia il linguaggio.
    const before = new Map(this.tabs.within(entry.path).map((tab) => [tab, tab.path]));
    for (const tab of this.tabs.rename(entry.path, to)) {
      this.applyEffects(tab, reconfigureEffects({ path: tab.path }));
      // La bozza segue il file.
      const old = before.get(tab);
      if (old && this.drafted.has(old)) {
        this.dropDraft(old, tab);
        if (tab.dirty) void this.writeDraft(tab);
      }
    }
    // Anche le bozze lasciate in sospeso seguono il file.
    for (const [path, deferred] of [...this.deferredDrafts]) {
      if (path !== entry.path && !path.startsWith(entry.path + '/')) continue;
      const moved = to + path.slice(entry.path.length);
      // Al nuovo nome c'è già un'altra bozza in sospeso: questa resta dov'è.
      if (this.deferredDrafts.has(moved)) continue;
      const draft = { ...deferred.draft, path: moved, client: CLIENT_ID };
      // Subito, prima di aspettare il server: una modifica fatta intanto vale già per il nuovo nome.
      this.deferredDrafts.delete(path);
      this.deferredDrafts.set(moved, { draft, asked: deferred.asked });
      try {
        await api.saveDraft(moved, draft.content, draft.etag);
      } catch {
        this.deferredDrafts.delete(moved);
        this.deferredDrafts.set(path, deferred);
        continue;
      }
      await api.deleteDraft(path, deferred.draft.client ?? null).catch(() => undefined);
    }
    // La cronologia aperta su quel percorso non è più valida.
    if (this.history && (this.history.path === entry.path || this.history.path.startsWith(entry.path + '/'))) {
      this.history = null;
    }
    // L'anteprima segue il file.
    if (this.preview && (this.preview === entry.path || this.preview.startsWith(entry.path + '/'))) {
      this.preview = to + this.preview.slice(entry.path.length);
    }
    this.tree.forget(entry.path);
    await this.tree.refresh(dirname(entry.path));
    await this.tree.reveal(to, entry.type as 'file' | 'directory');
    this.refreshTabs();
    this.refreshStatus();
    this.scheduleSession();
  }

  private async deleteEntry(entry: { path: string; type: string }): Promise<void> {
    const name = basename(entry.path);
    const affected = this.tabs.within(entry.path);
    const dirty = affected.filter((t) => t.dirty);
    const what = entry.type === 'directory' ? t('delete.folderWhat', { name }) : name;
    const ok = await this.dialog.confirm({
      title: entry.type === 'directory' ? t('delete.folderTitle') : t('delete.fileTitle'),
      message:
        t('delete.message', { what }) +
        (dirty.length ? t('delete.dirtyWarning', { names: dirty.map((d) => d.name).join(', ') }) : ''),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    let noBackup = false;
    for (;;) {
      try {
        await api.remove(entry.path, noBackup);
        break;
      } catch (err) {
        // File o cartelle molto grandi non hanno copia di sicurezza: il server lo dice prima,
        // e si elimina solo dopo una seconda conferma esplicita.
        if (err instanceof ApiError && err.code === 'no_backup' && !noBackup) {
          const sure = await this.dialog.confirm({
            title: entry.type === 'directory' ? t('delete.folderTitle') : t('delete.fileTitle'),
            message: t('delete.noBackupConfirm', { what }),
            confirmLabel: t('delete.noBackupConfirmLabel'),
            danger: true,
          });
          if (!sure) return;
          noBackup = true;
          continue;
        }
        this.toasts.show(t('delete.failed', { name, error: this.errorText(err) }), 'error');
        return;
      }
    }
    for (const tab of affected) await this.closeTab(tab.path, { force: true });
    // Eliminato su conferma: anche le bozze in sospeso di quei file non servono più.
    for (const [path, deferred] of [...this.deferredDrafts]) {
      if (path !== entry.path && !path.startsWith(entry.path + '/')) continue;
      this.deferredDrafts.delete(path);
      await api.deleteDraft(path, deferred.draft.client ?? null).catch(() => undefined);
    }
    if (this.history && (this.history.path === entry.path || this.history.path.startsWith(entry.path + '/'))) {
      this.history = null;
    }
    if (this.preview && (this.preview === entry.path || this.preview.startsWith(entry.path + '/'))) {
      this.closePreview();
    }
    this.tree.forget(entry.path);
    await this.tree.refresh(dirname(entry.path));
    this.flash(t('delete.done', { name }));
  }

  /**
   * FS-8: copia di un file accanto all'originale. Un .yaml duplicato in una cartella caricata
   * da HA (packages, !include_dir_…) verrebbe caricato due volte: la copia proposta finisce
   * in .bak, che HA ignora, e un nome .yaml va confermato.
   */
  private async duplicate(entry: { path: string; type: string }): Promise<void> {
    if (entry.type !== 'file') return;
    const old = basename(entry.path);
    const dot = old.lastIndexOf('.');
    const stem = dot > 0 ? old.slice(0, dot) : old;
    const ext = dot > 0 ? old.slice(dot) : '';
    const isYaml = /\.ya?ml$/i.test(old);
    const proposed = `${stem}_${t('duplicate.suffix')}`;
    const name = await this.dialog.prompt({
      title: t('duplicate.fileTitle'),
      ...(isYaml ? { message: t('duplicate.yamlHint') } : {}),
      label: t('duplicate.label'),
      value: proposed + ext + (isYaml ? '.bak' : ''),
      selectUntil: proposed.length,
      confirmLabel: t('common.create'),
      validate: (v) => validateName(v) ?? (v === old ? t('rename.same') : null),
    });
    if (name === null) return;
    if (/\.ya?ml$/i.test(name)) {
      const ok = await this.dialog.confirm({
        title: t('duplicate.yamlTitle'),
        message: t('duplicate.yamlWarning', { name }),
        confirmLabel: t('duplicate.yamlConfirm'),
        danger: true,
      });
      if (!ok) return;
    }
    const dir = dirname(entry.path);
    const to = join(dir, name);
    try {
      await api.copy(entry.path, to);
    } catch (err) {
      this.toasts.show(t('duplicate.failed', { name: old, error: this.errorText(err) }), 'error');
      return;
    }
    await this.tree.refresh(dir);
    await this.tree.reveal(to, 'file');
    await this.openFile(to);
    this.flash(t('duplicate.done', { name }));
  }

  // ——— cronologia: confronto e ripristino (BK-2, BK-3, BK-4) ———

  private async openHistory(path: string): Promise<void> {
    const tab = this.tabs.find(path);
    let current: string;
    let readOnly: boolean;
    if (tab) {
      current = docText(this.pane.stateOf(tab));
      readOnly = tab.readOnly;
    } else {
      try {
        const file = await api.read(path);
        current = file.content;
        readOnly = file.readOnly;
      } catch (err) {
        this.toasts.show(this.openErrorText(path, err), 'error');
        return;
      }
    }
    if (this.narrow) this.drawerOpen = false;
    this.previewShown = false;
    this.history = { path, current, readOnly };
  }

  private closeHistory(): void {
    this.history = null;
    if (!this.touchQuery.matches) this.pane.focusEditor();
  }

  private async restoreVersion(id: string, createdAt: string): Promise<void> {
    if (!this.history) return;
    const { path } = this.history;
    const name = basename(path);
    const date = formatVersionDate(createdAt);
    const tab = this.tabs.find(path);
    const ok = await this.dialog.confirm({
      title: t('history.confirmTitle'),
      message: t('history.confirmMessage', { name, date }) + (tab?.dirty ? t('history.dirtyWarning') : ''),
      confirmLabel: t('history.restore'),
    });
    if (!ok) return;
    try {
      await api.restore(path, id);
    } catch (err) {
      this.toasts.show(t('history.failed', { name, error: this.errorText(err) }), 'error');
      return;
    }
    // La tab aperta mostra il contenuto ripristinato; Annulla nell'editor lo riporta indietro.
    if (tab) await this.reloadFromDisk(tab, true);
    this.history = null;
    if (tab) this.activate(tab.path);
    this.flash(t('history.restored', { date }));
  }

  // ——— upload e download dal PC (FS-6) ———

  private uploadDir = '';

  private pickUpload(dir: string): void {
    const input = this.renderRoot.querySelector('#upload-input') as HTMLInputElement;
    this.uploadDir = dir;
    input.value = '';
    input.click();
  }

  private async uploadFiles(dir: string, files: File[]): Promise<void> {
    if (files.length === 0) return;
    const where = dir === '' ? '/config' : `/config/${dir}`;
    const done: string[] = [];
    for (const file of files) {
      let overwrite = false;
      let noBackup = false;
      for (;;) {
        try {
          await api.upload(dir, file.name, file, overwrite, noBackup);
          done.push(file.name);
          break;
        } catch (err) {
          if (err instanceof ApiError && err.code === 'no_backup' && !noBackup) {
            const sure = await this.dialog.confirm({
              title: t('upload.existsTitle'),
              message: t('upload.noBackupConfirm', { name: file.name }),
              confirmLabel: t('upload.overwrite'),
              danger: true,
            });
            if (!sure) break;
            noBackup = true;
            continue;
          }
          if (err instanceof ApiError && err.code === 'already_exists' && !overwrite) {
            const choice = await this.dialog.choose({
              title: t('upload.existsTitle'),
              message: t('upload.existsMessage', { name: file.name, where }),
              choices: [
                { id: 'cancel', label: t('common.cancel') },
                { id: 'skip', label: t('upload.skip') },
                { id: 'overwrite', label: t('upload.overwrite'), variant: 'danger' },
              ],
              defaultId: 'skip',
            });
            if (choice === 'overwrite') {
              overwrite = true;
              continue;
            }
            if (choice === null) return this.afterUpload(dir, done);
            break;
          }
          const message =
            err instanceof ApiError && err.code === 'read_only'
              ? t('upload.readOnly')
              : t('upload.failed', { name: file.name, error: this.errorText(err) });
          this.toasts.show(message, 'error');
          break;
        }
      }
    }
    await this.afterUpload(dir, done);
  }

  private async afterUpload(dir: string, done: string[]): Promise<void> {
    if (done.length === 0) return;
    await this.tree.refresh(dir);
    // Le tab aperte sui file sostituiti mostrano subito il nuovo contenuto, se non hanno modifiche.
    for (const name of done) {
      const tab = this.tabs.find(join(dir, name));
      if (tab && !tab.dirty) await this.reloadFromDisk(tab, true);
    }
    this.flash(done.length === 1 ? t('upload.doneOne', { name: done[0]! }) : t('upload.doneMany', { n: done.length }));
  }

  /** Il browser scarica il file (o lo ZIP della cartella) sul PC da cui si usa Editha. */
  private download(path: string): void {
    const link = document.createElement('a');
    link.href = api.downloadUrl(path);
    link.download = '';
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
  }

  private async copyPath(path: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(`/config/${path}`);
      this.flash(t('copy.done'));
    } catch {
      this.toasts.show(t('copy.failed'), 'warning');
    }
  }

  private async onTreeContext(e: CustomEvent<{ entry: Entry | null; x: number; y: number }>): Promise<void> {
    const { entry, x, y } = e.detail;
    const ro = entry?.readOnly ?? false;
    const dirRo = entry ? entry.readOnly : false;
    let items: MenuEntry[];
    if (!entry) {
      items = [
        { id: 'new-file', label: t('tree.newFile'), icon: icons.fileNew },
        { id: 'new-folder', label: t('tree.newFolder'), icon: icons.folderNew },
        { id: 'upload', label: t('tree.uploadHere'), icon: icons.upload },
        'separator',
        { id: 'refresh', label: t('common.refresh'), icon: icons.refresh },
      ];
    } else if (entry.type === 'directory') {
      items = [
        { id: 'new-file', label: t('tree.newFile'), icon: icons.fileNew, disabled: dirRo },
        { id: 'new-folder', label: t('tree.newFolder'), icon: icons.folderNew, disabled: dirRo },
        { id: 'upload', label: t('tree.uploadHere'), icon: icons.upload, disabled: dirRo },
        { id: 'download', label: t('tree.downloadZip'), icon: icons.zip },
        'separator',
        { id: 'rename', label: t('common.rename'), icon: icons.rename, hint: 'F2', disabled: ro },
        { id: 'move', label: t('move.menu'), icon: icons.move, disabled: ro },
        { id: 'copy-path', label: t('common.copyPath'), icon: icons.copy },
        'separator',
        { id: 'delete', label: t('common.delete'), icon: icons.delete, hint: t('common.deleteKey'), danger: true, disabled: ro },
      ];
    } else {
      items = [
        { id: 'open', label: t('common.open'), icon: icons.file, disabled: entry.type !== 'file' },
        // Un SVG si apre in anteprima, ma è testo: si può anche modificare.
        ...(entry.type === 'file' && extension(entry.path) === 'svg'
          ? [{ id: 'open-text', label: t('preview.openAsText'), icon: icons.file }]
          : []),
        // L'anteprima è una sola e occupa tutta l'area: a destra vanno solo i file di testo.
        ...(this.narrow || (entry.type === 'file' && previewKind(entry.path) && extension(entry.path) !== 'svg')
          ? []
          : [{ id: 'open-side', label: t('split.openRight'), icon: icons.split, disabled: entry.type !== 'file' }]),
        { id: 'download', label: t('tree.download'), icon: icons.download, disabled: entry.type !== 'file' },
        { id: 'history', label: t('tree.history'), icon: icons.history, disabled: entry.type !== 'file' },
        ...(this.compareBase && this.compareBase !== entry.path && entry.type === 'file'
          ? [{ id: 'compare', label: t('compare.with', { name: basename(this.compareBase) }), icon: icons.compare }]
          : []),
        { id: 'compare-select', label: t('compare.select'), icon: icons.compare, disabled: entry.type !== 'file' },
        'separator',
        { id: 'duplicate', label: t('tree.duplicate'), icon: icons.duplicate, disabled: ro || entry.type !== 'file' },
        { id: 'rename', label: t('common.rename'), icon: icons.rename, hint: 'F2', disabled: ro },
        { id: 'move', label: t('move.menu'), icon: icons.move, disabled: ro || entry.type === 'other' },
        { id: 'copy-path', label: t('common.copyPath'), icon: icons.copy },
        'separator',
        { id: 'delete', label: t('common.delete'), icon: icons.delete, hint: t('common.deleteKey'), danger: true, disabled: ro },
      ];
    }
    const choice = await this.menu.show(items, x, y);
    switch (choice) {
      case 'new-file':
        return this.create('file', this.targetDir(entry));
      case 'new-folder':
        return this.create('directory', this.targetDir(entry));
      case 'refresh':
        return this.tree.refreshAll();
      case 'open':
        return entry ? this.openFile(entry.path) : undefined;
      case 'open-text':
        return entry ? this.openFile(entry.path, true) : undefined;
      case 'open-side':
        return entry ? this.openInSide(entry.path) : undefined;
      case 'rename':
        return entry ? this.rename(entry) : undefined;
      case 'copy-path':
        return entry ? this.copyPath(entry.path) : undefined;
      case 'upload':
        return this.pickUpload(this.targetDir(entry));
      case 'download':
        return entry ? this.download(entry.path) : undefined;
      case 'delete':
        return entry ? this.deleteEntry(entry) : undefined;
      case 'duplicate':
        return entry ? this.duplicate(entry) : undefined;
      case 'move':
        return entry ? this.moveEntry(entry) : undefined;
      case 'compare-select':
        if (entry) {
          this.compareBase = entry.path;
          this.toasts.show(t('compare.selected', { name: basename(entry.path) }), 'info');
        }
        return;
      case 'compare':
        return entry && this.compareBase ? this.openCompare(this.compareBase, entry.path) : undefined;
      case 'history':
        return entry ? this.openHistory(entry.path) : undefined;
    }
  }

  private onTreeAction(e: CustomEvent<{ action: string }>): void {
    const sel = this.tree.getSelection();
    switch (e.detail.action) {
      case 'new-file':
        void this.create('file');
        break;
      case 'new-folder':
        void this.create('directory');
        break;
      case 'rename':
        if (sel && !sel.readOnly) void this.rename(sel);
        break;
      case 'delete':
        if (sel && !sel.readOnly) void this.deleteEntry(sel);
        break;
      case 'upload':
        this.pickUpload(this.targetDir());
        break;
      case 'search':
        void this.openSearch();
        break;
      case 'toggle-system':
        void this.updateSettings({ showSystem: !this.settings.showSystem });
        break;
    }
  }

  // ——— inserimento di entità e snippet ———

  private toggleInsert(): void {
    this.insertOpen = !this.insertOpen;
    this.refreshToolbar();
    if (this.insertOpen) {
      void this.updateComplete.then(() =>
        (this.renderRoot.querySelector('editha-insert-panel') as EdithaInsertPanel | null)?.focusSearch(),
      );
    }
  }

  private insertText(text: string): void {
    if (!this.editor.insertText(text)) this.toasts.show(t('insert.needEditable'), 'warning');
  }

  private insertSnippet(body: string, fields: boolean): void {
    if (!this.editor.insertBlock(fillIds(body), fields)) {
      this.toasts.show(t('insert.needEditable'), 'warning');
      return;
    }
    if (fields) this.toasts.show(t('insert.fieldsHint'), 'info');
  }

  private async loadSnippets(): Promise<void> {
    try {
      this.userSnippets = (await api.snippets()).snippets;
    } catch {
      this.userSnippets = [];
    }
  }

  private async saveSnippets(list: Snippet[]): Promise<boolean> {
    try {
      this.userSnippets = (await api.saveSnippets({ snippets: list })).snippets;
      return true;
    } catch (err) {
      this.toasts.show(t('snippet.notSaved', { error: this.errorText(err) }), 'error');
      return false;
    }
  }

  private async saveSelectionAsSnippet(): Promise<void> {
    const selection = this.editor.selectionForSnippet();
    const body = normalizeSnippetBody(selection.text, selection.column);
    if (!body.trim()) {
      this.toasts.show(t('snippet.selectFirst'), 'warning');
      return;
    }
    if (body.length > 20000) {
      this.toasts.show(t('snippet.tooLong'), 'warning');
      return;
    }
    const name = await this.dialog.prompt({
      title: t('snippet.newTitle'),
      label: t('snippet.nameLabel'),
      confirmLabel: t('common.save'),
      validate: (v) => (v.trim() ? (v.length > 120 ? t('name.tooLong') : null) : t('name.empty')),
    });
    if (name === null) return;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const trimmed = name.trim();
    if (await this.saveSnippets([...this.userSnippets, { id, name: trimmed, body }])) this.flash(t('snippet.saved', { name: trimmed }));
  }

  private async editSnippet(id: string): Promise<void> {
    const snippet = this.userSnippets.find((s) => s.id === id);
    if (!snippet) return;
    const editor = this.renderRoot.querySelector('editha-snippet-editor') as EdithaSnippetEditor;
    const changed = await editor.edit(snippet);
    if (!changed) return;
    const list = this.userSnippets.map((s) => (s.id === id ? { ...s, ...changed } : s));
    if (await this.saveSnippets(list)) this.flash(t('snippet.saved', { name: changed.name }));
  }

  private async deleteSnippet(id: string, name: string): Promise<void> {
    const ok = await this.dialog.confirm({
      title: t('snippet.deleteTitle'),
      message: t('snippet.deleteMessage', { name }),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (ok && (await this.saveSnippets(this.userSnippets.filter((s) => s.id !== id)))) this.flash(t('snippet.deleted'));
  }

  // ——— Home Assistant: verifica, ricarica, riavvio (ACT-1, ACT-2, ACT-4) ———

  private async haMenu(rect?: DOMRect): Promise<void> {
    // Fuori da Home Assistant (sviluppo) le voci restano visibili ma disattivate.
    const off = !haData.available;
    const items: MenuEntry[] = [
      { id: 'check', label: t('ha.check'), icon: icons.check, disabled: off },
      { id: 'reload', label: t('ha.reload'), icon: icons.reload, disabled: off },
      'separator',
      { id: 'restart', label: t('ha.restart'), icon: icons.restart, danger: true, disabled: off },
    ];
    const x = rect ? rect.left : 16;
    const y = rect ? rect.bottom + 4 : 56;
    const choice = await this.menu.show(items, x, y);
    if (choice === 'check') await this.haCheck();
    else if (choice === 'reload') await this.haReload();
    else if (choice === 'restart') await this.haRestart();
  }

  private async withHa<T>(label: string, task: () => Promise<T>): Promise<T | null> {
    this.haBusy = true;
    this.refreshToolbar();
    this.toasts.show(label, 'info');
    try {
      return await task();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'config_invalid') {
        await this.dialog.inform({
          title: t('ha.invalidTitle'),
          message: t('ha.invalidAborted'),
          detail: String(err.details.errors ?? err.message),
        });
      } else {
        this.toasts.show(this.errorText(err), 'error');
      }
      return null;
    } finally {
      this.haBusy = false;
      this.refreshToolbar();
    }
  }

  /** Ricarica e riavvio leggono i file su disco: prima si decide cosa fare delle modifiche non salvate. */
  private async ensureSaved(): Promise<boolean> {
    const dirty = this.tabs.tabs.filter((t) => t.dirty && !t.readOnly);
    if (dirty.length === 0) return true;
    const choice = await this.dialog.choose({
      title: t('unsaved.title'),
      message: t(dirty.length === 1 ? 'unsaved.messageOne' : 'unsaved.messageMany', {
        names: dirty.map((d) => d.name).join(', '),
      }),
      choices: [
        { id: 'cancel', label: t('common.cancel') },
        { id: 'skip', label: t('unsaved.skip') },
        { id: 'save', label: t('unsaved.save'), variant: 'primary' },
      ],
      defaultId: 'save',
    });
    if (choice === null) return false;
    if (choice === 'save') {
      await this.saveAll();
      return !this.tabs.tabs.some((t) => t.dirty && !t.readOnly);
    }
    return true;
  }

  private async haCheck(): Promise<void> {
    if (!(await this.ensureSaved())) return;
    const res = await this.withHa(t('ha.checking'), () => api.ha.check());
    if (!res) return;
    if (res.valid) {
      if (res.warnings) {
        await this.dialog.inform({ title: t('ha.validWithWarnings'), detail: res.warnings });
      } else {
        this.toasts.show(t('ha.valid'), 'success');
      }
    } else {
      await this.dialog.inform({
        title: t('ha.invalidTitle'),
        message: t('ha.invalidFix'),
        detail: res.errors ?? t('ha.unknownError'),
      });
    }
  }

  private async haReload(): Promise<void> {
    if (!(await this.ensureSaved())) return;
    const res = await this.withHa(t('ha.reloading'), () => api.ha.reload());
    if (res) this.toasts.show(t('ha.reloaded'), 'success');
  }

  private async haRestart(): Promise<void> {
    const ok = await this.dialog.confirm({
      title: t('ha.restartTitle'),
      message: t('ha.restartMessage'),
      confirmLabel: t('ha.restartConfirm'),
      danger: true,
    });
    if (!ok || !(await this.ensureSaved())) return;
    const res = await this.withHa(t('ha.restarting'), () => api.ha.restart());
    if (res) this.toasts.show(t('ha.restarted'), 'success');
  }

  private onToolbarAction(e: CustomEvent<{ action: string; rect?: DOMRect }>): void {
    switch (e.detail.action) {
      case 'toggle-sidebar':
        return this.toggleSidebar();
      case 'save':
        return void this.save();
      case 'save-all':
        return void this.saveAll();
      case 'undo':
        return this.editor.command('undo');
      case 'redo':
        return this.editor.command('redo');
      case 'search':
        return this.editor.command('search');
      case 'search-all':
        return this.searchOpen ? this.closeSearch() : void this.openSearch();
      case 'split':
        return void (this.split ? this.closeSplit() : this.tabs.active && this.showInSide(this.tabs.active));
      case 'about':
        return (this.renderRoot.querySelector('editha-about-dialog') as EdithaAboutDialog).show();
      case 'history':
        return void (this.focusedTab() && this.openHistory(this.focusedTab()!.path));
      case 'word-wrap':
        return void this.toggleWordWrap();
      case 'outline':
        return void this.toggleOutline();
      case 'theme':
        return void this.cycleTheme();
      case 'insert':
        return this.toggleInsert();
      case 'ha-menu':
        return void this.haMenu(e.detail.rect);
      case 'language':
        return void this.languageMenu(e.detail.rect);
    }
  }

  // ——— tastiera e uscita ———

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = shortcutKey(e);
    // Con una finestra aperta (dialogo, scelta della cartella, snippet, informazioni) le
    // scorciatoie non agiscono sui file sotto di lei.
    const modal = () =>
      this.dialog.busy || e.composedPath().some((n) => n instanceof HTMLDialogElement && n.open);
    if (mod && e.shiftKey && key === 'f') {
      e.preventDefault();
      void this.openSearch();
    } else if (mod && key === 's') {
      e.preventDefault();
      if (modal()) return;
      if (e.altKey) void this.saveAll();
      else void this.save();
    } else if (e.altKey && !mod && key === 'w') {
      e.preventDefault();
      if (modal()) return;
      const tab = this.focusedTab();
      if (this.previewShown) this.closePreview();
      else if (tab) void this.closeTab(tab.path);
    }
  };

  /**
   * Esc chiude cronologia, confronto o anteprima. Ascoltato dopo i pannelli: un Esc dato in un
   * campo (ricerca, filtro, pannello Inserisci) vale per quel campo e basta.
   */
  private readonly onEscape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented || this.dialog.busy || this.menu.items) return;
    const path = e.composedPath();
    if (path.some((n) => n instanceof HTMLDialogElement && n.open)) return;
    const target = path[0];
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
    if (this.history) this.closeHistory();
    else if (this.compare) this.compare = null;
    else if (this.previewShown) this.closePreview();
    else return;
    e.preventDefault();
  };

  private readonly onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (this.tabs.tabs.some((t) => t.dirty)) e.preventDefault();
    whileLeaving(() => {
      this.flushDrafts();
      // Durante l'avvio la sessione non è ancora ripristinata: salvarla ora la cancellerebbe.
      if (this.sessionReady) void this.saveSession();
    });
  };

  // ——— stato visualizzato ———

  private refreshTabs(): void {
    this.tabViews = this.tabs.tabs.map((t) => ({ path: t.path, name: t.name, dirty: t.dirty, readOnly: t.readOnly }));
    this.activePath = this.tabs.active?.path ?? null;
    this.refreshToolbar();
  }

  // ——— schema del file (ED-18) ———

  /** Ricalcola lo schema quando cambia il testo (con un attimo di pausa mentre si scrive). */
  private updateOutline(tab: EditorTab | null, s: EditorState | null): void {
    if (!this.settings.outlineVisible || this.narrow) return;
    if (!tab || !s || languageOf(tab.path).id !== 'yaml') {
      clearTimeout(this.outlineTimer);
      this.outlineDoc = null;
      this.outline = null;
      this.outlineActive = -1;
      return;
    }
    const line = s.doc.lineAt(s.selection.main.head).number;
    if (s.doc !== this.outlineDoc) {
      // Altro file: subito; stesso file mentre si scrive: dopo una breve pausa.
      const fresh = this.outlineDoc === null || this.outline === null || this.outlineTab !== tab;
      this.outlineDoc = s.doc;
      this.outlineTab = tab;
      clearTimeout(this.outlineTimer);
      if (fresh) {
        this.outline = buildOutline(s.doc.toString());
      } else {
        this.outlineTimer = setTimeout(() => {
          this.outline = buildOutline(s.doc.toString());
          // Il cursore può essersi spostato nel frattempo: la voce attiva si rilegge adesso.
          this.refreshStatus();
        }, 300);
      }
    }
    if (this.outline) this.outlineActive = activeOutlineIndex(this.outline, line);
  }

  private async toggleOutline(): Promise<void> {
    const visible = !this.settings.outlineVisible;
    await this.updateSettings({ outlineVisible: visible });
    this.outlineDoc = null;
    this.refreshStatus();
  }

  private refreshStatus(state?: EditorState): void {
    const tab = this.focusedTab();
    if (!tab) {
      this.status = null;
      this.updateOutline(null, null);
      return;
    }
    const onSide = tab !== this.tabs.active || (this.split && this.sideFocused);
    const s = (onSide ? this.side?.viewState : null) ?? state ?? this.pane.stateOf(tab);
    this.updateOutline(tab, s);
    const head = s.selection.main.head;
    const line = s.doc.lineAt(head);
    const lang = languageOf(tab.path);
    let errors = 0;
    let warnings = 0;
    forEachDiagnostic(s, (d) => {
      if (d.severity === 'error') errors++;
      else if (d.severity === 'warning') warnings++;
    });
    this.status = {
      path: tab.path,
      line: line.number,
      column: head - line.from + 1,
      selected: s.selection.ranges.reduce((n, r) => n + (r.to - r.from), 0),
      language: lang.label,
      readOnly: tab.readOnly,
      dirty: tab.dirty,
      lint: lang.id === 'yaml' ? { errors, warnings, skipped: s.doc.length > LINT_MAX_CHARS } : null,
    };
  }

  private computeToolbar(state?: EditorState): ToolbarState {
    const onSide = this.split && this.sideFocused && !!this.side?.shown;
    const tab = this.focusedTab();
    const s = tab ? (onSide ? (this.side!.viewState ?? undefined) : (state ?? this.pane?.stateOf(tab))) : undefined;
    return {
      hasTab: !!tab,
      canSave: !!tab && tab.dirty && !tab.readOnly,
      canSaveAll: this.tabs.tabs.some((t) => t.dirty && !t.readOnly),
      canUndo: !!s && !tab?.readOnly && undoDepth(s) > 0,
      canRedo: !!s && !tab?.readOnly && redoDepth(s) > 0,
      wordWrap: this.settings.wordWrap,
      sidebarVisible: this.narrow ? this.drawerOpen : this.settings.sidebarVisible,
      theme: this.settings.theme,
      insertOpen: this.insertOpen ?? false,
      haBusy: this.haBusy ?? false,
      lang: getLang(),
      split: this.split ?? false,
      searchOpen: this.searchOpen ?? false,
      outline: this.settings.outlineVisible,
    };
  }

  private refreshToolbar(state?: EditorState): void {
    this.toolbar = this.computeToolbar(state);
  }

  /** Conferma breve di un'operazione riuscita. */
  private flash(message: string): void {
    this.toasts.show(message, 'success');
  }

  private errorText(err: unknown): string {
    return errorText(err);
  }

  private openErrorText(path: string, err: unknown): string {
    const name = basename(path);
    if (err instanceof ApiError) {
      if (err.code === 'binary') return t('open.binary', { name });
      if (err.code === 'too_large') return t('open.tooLarge', { name });
      if (err.code === 'not_found') return t('open.notFound', { name });
    }
    return t('open.failed', { name, error: this.errorText(err) });
  }

  // ——— ridimensionamento dell'albero ———

  private startResize(e: PointerEvent): void {
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    const startX = e.clientX;
    const startWidth = this.settings.sidebarWidth;
    const move = (ev: PointerEvent) => {
      const width = Math.round(Math.max(160, Math.min(640, startWidth + ev.clientX - startX)));
      this.settings = { ...this.settings, sidebarWidth: width };
    };
    const up = () => {
      handle.classList.remove('dragging');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      void this.updateSettings({ sidebarWidth: this.settings.sidebarWidth });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    // Trascinamento interrotto (es. il sistema prende il tocco): si chiude comunque.
    handle.addEventListener('pointercancel', up);
  }

  override render() {
    const showSidebar = this.narrow ? this.drawerOpen : this.settings.sidebarVisible;
    return html`
      <editha-toolbar .state=${this.toolbar} @toolbar-action=${this.onToolbarAction}></editha-toolbar>
      ${this.renderBanner()}
      <div class="body">
        <aside style="width:${this.settings.sidebarWidth}px" ?hidden=${!showSidebar}>
          <editha-search-panel
            ?hidden=${!this.searchOpen}
            @search-close=${() => this.closeSearch()}
            @search-replace=${(e: Parameters<EdithaApp['replaceInFiles']>[0]) => void this.replaceInFiles(e)}
            @search-open=${(e: CustomEvent<{ path: string; match: SearchMatch }>) =>
              void this.openSearchResult(e.detail.path, e.detail.match)}
          ></editha-search-panel>
          <editha-file-tree
            ?hidden=${this.searchOpen}
            .activePath=${this.previewShown ? this.preview : this.activePath}
            .showSystem=${this.settings.showSystem}
            @file-open=${(e: CustomEvent<{ path: string }>) => void this.openFile(e.detail.path)}
            @tree-context=${this.onTreeContext}
            @tree-action=${this.onTreeAction}
            @files-drop=${(e: CustomEvent<{ dir: string; files: File[] }>) =>
              void this.uploadFiles(e.detail.dir, e.detail.files)}
          ></editha-file-tree>
        </aside>
        ${showSidebar && !this.narrow
          ? html`<div class="resizer" title=${t('conn.resize')} @pointerdown=${this.startResize}></div>`
          : null}
        ${this.narrow && this.drawerOpen ? html`<div class="drawer-scrim" @click=${() => (this.drawerOpen = false)}></div>` : null}
        ${this.compare
          ? html`<editha-compare-panel
              .left=${this.compare.left}
              .right=${this.compare.right}
              .prefs=${{ wordWrap: this.settings.wordWrap, fontSize: this.settings.fontSize }}
              @compare-close=${() => (this.compare = null)}
            ></editha-compare-panel>`
          : null}
        ${this.history
          ? html`<editha-history-panel
              .path=${this.history.path}
              .current=${this.history.current}
              .prefs=${{ wordWrap: this.settings.wordWrap, fontSize: this.settings.fontSize }}
              .canRestore=${!this.history.readOnly}
              @history-close=${() => this.closeHistory()}
              @history-space=${() => void this.openHistorySpace()}
              @history-restore=${(e: CustomEvent<{ id: string; date: string }>) =>
                void this.restoreVersion(e.detail.id, e.detail.date)}
            ></editha-history-panel>`
          : null}
        <main>
          <editha-tab-bar
            ?hidden=${this.tabViews.length === 0 && !this.preview}
            .tabs=${this.tabViews}
            .active=${this.previewShown ? this.preview : this.activePath}
            .preview=${this.preview}
            @tab-activate=${(e: CustomEvent<{ path: string }>) => this.activate(e.detail.path)}
            @tab-close=${(e: CustomEvent<{ path: string }>) => void this.closeTab(e.detail.path)}
            @preview-activate=${() => this.showPreview()}
            @preview-close=${() => this.closePreview()}
          ></editha-tab-bar>
          <div class="editors" @editha-link=${(e: CustomEvent<{ kind: LinkKind; target: string; file: string }>) => void this.followLink(e)}>
          <editha-editor-pane>
            <div class="welcome" slot="empty">
              <div class="logo">E</div>
              <h1>EDITHA</h1>
              <p>${t('app.tagline')}</p>
              <div class="keys">
                <span><kbd>Ctrl</kbd> + <kbd>S</kbd></span><span>${t('welcome.save')}</span>
                <span><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>S</kbd></span><span>${t('welcome.saveAll')}</span>
                <span><kbd>Ctrl</kbd> + <kbd>F</kbd></span><span>${t('welcome.search')}</span>
                <span><kbd>Alt</kbd> + <kbd>W</kbd></span><span>${t('welcome.closeTab')}</span>
                <span><kbd>Tab</kbd> / <kbd>Shift</kbd> + <kbd>Tab</kbd></span><span>${t('welcome.indent')}</span>
                <span><kbd>Ctrl</kbd> + <kbd>Space</kbd></span><span>${t('welcome.complete')}</span>
                <span><kbd>F2</kbd></span><span>${t('welcome.rename')}</span>
              </div>
            </div>
          </editha-editor-pane>
          ${this.renderSide()}
          ${this.settings.outlineVisible && !this.narrow
            ? html`<editha-outline-panel
                .items=${this.outline}
                .active=${this.outlineActive}
                .file=${this.outline ? (this.outlineTab?.path ?? null) : null}
                @outline-go=${(e: CustomEvent<{ line: number }>) => this.editor.goToLine(e.detail.line, 'start')}
                @outline-close=${() => void this.toggleOutline()}
              ></editha-outline-panel>`
            : null}
          ${this.preview && this.previewShown
            ? html`<editha-preview-panel
                .path=${this.preview}
                @preview-download=${(e: CustomEvent<{ path: string }>) => this.download(e.detail.path)}
                @preview-close=${() => this.closePreview()}
              ></editha-preview-panel>`
            : null}
          </div>
          ${this.insertOpen
            ? html`<editha-insert-panel
                .tab=${this.insertTab}
                .userSnippets=${this.userSnippets}
                .canInsert=${!!this.focusedTab() && !this.focusedTab()!.readOnly}
                @insert-text=${(e: CustomEvent<{ text: string }>) => this.insertText(e.detail.text)}
                @insert-snippet=${(e: CustomEvent<{ body: string; fields: boolean }>) =>
                  this.insertSnippet(e.detail.body, e.detail.fields)}
                @snippet-save=${() => void this.saveSelectionAsSnippet()}
                @snippet-edit=${(e: CustomEvent<{ id: string }>) => void this.editSnippet(e.detail.id)}
                @snippet-delete=${(e: CustomEvent<{ id: string; name: string }>) =>
                  void this.deleteSnippet(e.detail.id, e.detail.name)}
                @panel-close=${() => this.toggleInsert()}
                @entity-usages=${(e: CustomEvent<{ id: string }>) =>
                  void this.openSearch({ query: e.detail.id, wholeWord: true, caseSensitive: true })}
              ></editha-insert-panel>`
            : null}
        </main>
      </div>
      <editha-status-bar
        .info=${this.status}
        .preview=${this.previewShown ? this.preview : null}
        @open-problems=${() => this.editor.openProblems()}></editha-status-bar>
      <input
        id="upload-input"
        type="file"
        multiple
        hidden
        @change=${(e: Event) => {
          const files = [...((e.target as HTMLInputElement).files ?? [])];
          void this.uploadFiles(this.uploadDir, files);
        }}
      />
      <editha-dialog></editha-dialog>
      <editha-context-menu></editha-context-menu>
      <editha-about-dialog @history-space=${() => void this.openHistorySpace()}></editha-about-dialog>
      <editha-history-space @history-pruned=${() => void this.afterHistoryPruned()}></editha-history-space>
      <editha-folder-picker></editha-folder-picker>
      <editha-snippet-editor></editha-snippet-editor>
      <editha-toasts></editha-toasts>
    `;
  }
}

customElements.define('editha-app', EdithaApp);
