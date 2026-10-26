import { LitElement, css, html } from 'lit';
import type { ChangeSet, EditorState, StateEffect, Text } from '@codemirror/state';
import type { ViewUpdate } from '@codemirror/view';
import { redoDepth, undoDepth } from '@codemirror/commands';
import { forEachDiagnostic } from '@codemirror/lint';
import { api, ApiError, errorText } from '../api/client.js';
import { getLang, onLangChange, resolveLang, setLang, t, type LanguageSetting, type MessageKey } from '../i18n/index.js';
import { connection } from '../api/connection.js';
import type { Entry, Settings, ThemeMode } from '../api/types.js';
import { createEditorState, docText, reconfigureEffects } from '../editor/setup.js';
import { languageOf } from '../editor/languages.js';
import { LINT_MAX_CHARS } from '../editor/yaml-lint.js';
import { basename } from '../state/paths.js';
import { previewKind } from '../state/preview.js';
import { MAC } from '../state/keys.js';
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
import type { InsertDetail, InsertTab } from './insert-panel.js';
import { detailAtPos } from '../editor/ha-complete.js';
import type { Snippet } from '../api/types.js';
import { haData } from '../state/ha-data.js';
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
import './template-panel.js';
import './git-panel.js';
import type { TemplateView } from './template-panel.js';
import './side-pane.js';
import './about-dialog.js';
import './history-space.js';
import './folder-picker.js';
import './search-panel.js';
import './compare-panel.js';
import './preview-panel.js';
import './gallery-panel.js';
import './outline-panel.js';
import type { OutlineItem } from '../editor/outline.js';
import './snippet-editor.js';
import type { CompareSide } from './compare-panel.js';
import type { SearchMatch } from '../api/types.js';
import type { EdithaAboutDialog } from './about-dialog.js';
import type { EdithaSidePane } from './side-pane.js';
import { DraftsController } from '../app/drafts.js';
import { FileOpsController } from '../app/file-ops.js';
import { GitController } from '../app/git.js';
import { HaController } from '../app/ha.js';
import { SnippetsController } from '../app/snippets.js';
import { HistoryController } from '../app/history.js';
import { SessionController } from '../app/session.js';
import { SaveController } from '../app/save.js';
import { KeyboardController } from '../app/keyboard.js';
import { SearchController } from '../app/search.js';
import { SplitController } from '../app/split.js';
import { OutlineController } from '../app/outline.js';
import { ServerController } from '../app/server.js';

/** Tasti della pagina iniziale: sul Mac ⌘ ⌥ ⇧ al posto di Ctrl, Alt e Shift. */
const KEY = MAC ? { mod: '⌘', alt: '⌥', shift: '⇧' } : { mod: 'Ctrl', alt: 'Alt', shift: 'Shift' };

const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  sidebarVisible: true,
  sidebarWidth: 280,
  wordWrap: false,
  fontSize: 14,
  showSystem: false,
  language: 'auto',
  outlineVisible: false,
  haHints: true,
};

const NARROW = '(max-width: 760px)';

/**
 * Componente principale: tiene insieme albero, tab, editor e barre. Le singole funzioni stanno
 * nei controller di src/app/; i membri senza `private` sono quelli che usano loro (non sono API
 * dell'elemento).
 */
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
    insertDetail: { state: true },
    template: { state: true },
    insertTab: { state: true },
    userSnippets: { state: true },
    haBusy: { state: true },
    offline: { state: true },
    addonUpdated: { state: true },
    history: { state: true },
    split: { state: true },
    sideFocused: { state: true },
    searchOpen: { state: true },
    gitOpen: { state: true },
    compare: { state: true },
    preview: { state: true },
    galleryRevision: { state: true },
    previewGallery: { state: true },
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
  /** Entità del blocco del cursore per il riquadro del pannello Inserisci (HA-12). */
  declare insertDetail: InsertDetail | null;
  /** HA-7: anteprima di un template aperta (file e prima riga del template). */
  declare template: { view: TemplateView; file: string; line: number; updating: boolean } | null;
  declare insertTab: InsertTab;
  declare userSnippets: Snippet[];
  /** Un'operazione su HA è in corso: il menu resta disabilitato. */
  declare haBusy: boolean;
  /** Il server non risponde (app in aggiornamento o riavvio, sessione scaduta). */
  declare offline: boolean;
  /** L'app è stata aggiornata mentre la pagina era aperta. */
  declare addonUpdated: boolean;
  /** Cronologia aperta: file e contenuto attuale con cui confrontare le versioni. */
  declare history: { path: string; current: string; readOnly: boolean } | null;
  /** ED-17: vista divisa in due colonne (solo su schermi larghi). */
  declare split: boolean;
  /** L'ultima colonna usata è quella destra: salva, annulla, inserisci agiscono lì. */
  declare sideFocused: boolean;
  /** SR-1: nella barra laterale c'è la ricerca al posto dell'albero. */
  declare searchOpen: boolean;
  /** GIT-1: pannello Git nella barra laterale, al posto dell'albero. */
  declare gitOpen: boolean;
  /** BK-6: confronto tra due file aperto. */
  declare compare: { left: CompareSide; right: CompareSide } | null;
  /** FS-10: immagine o PDF mostrato al posto dell'editor. */
  declare preview: string | null;
  /** Cresce quando cambia il contenuto della cartella della galleria (FS-11). */
  declare galleryRevision: number;
  /** La tab di anteprima mostra la galleria di una cartella, non un file (FS-11). */
  declare previewGallery: boolean;
  /** La tab di anteprima è quella in primo piano (l'editor sotto non riceve comandi). */
  declare previewShown: boolean;
  /** ED-18: schema del file in uso (null se non è YAML) e voce in cui si trova il cursore. */
  declare outline: OutlineItem[] | null;
  declare outlineActive: number;
  private offLang: (() => void) | null = null;

  /** Controller delle singole funzioni (src/app/): ricevono l'elemento e lavorano sui suoi membri. */
  readonly drafts = new DraftsController(this);
  readonly fileOps = new FileOpsController(this);
  readonly git = new GitController(this);
  readonly ha = new HaController(this);
  readonly snippets = new SnippetsController(this);
  /** Cronologia dei file ("history" è già lo stato del pannello aperto). */
  readonly versions = new HistoryController(this);
  readonly session = new SessionController(this);
  readonly saver = new SaveController(this);
  readonly keys = new KeyboardController(this);
  readonly search = new SearchController(this);
  /** Vista divisa ("split" è già lo stato: colonna destra aperta o no). */
  readonly splitView = new SplitController(this);
  /** Schema del file ("outline" è già lo stato mostrato dal pannello). */
  readonly outlineView = new OutlineController(this);
  readonly server = new ServerController(this);

  readonly tabs = new TabsModel<EditorState>();
  /** Testo salvato su disco per ogni tab: serve a sapere se ci sono modifiche. */
  readonly saved = new WeakMap<EditorTab, Text>();
  private readonly narrowQuery = window.matchMedia(NARROW);
  readonly touchQuery = window.matchMedia('(pointer: coarse)');
  private editorFocused = false;

  constructor() {
    super();
    this.settings = DEFAULT_SETTINGS;
    this.tabViews = [];
    this.activePath = null;
    this.status = null;
    this.narrow = this.narrowQuery.matches;
    this.drawerOpen = false;
    this.insertOpen = false;
    this.insertDetail = null;
    this.template = null;
    this.insertTab = 'entities';
    this.userSnippets = [];
    this.haBusy = false;
    this.offline = false;
    this.addonUpdated = false;
    this.history = null;
    this.split = false;
    this.sideFocused = false;
    this.searchOpen = false;
    this.gitOpen = false;
    this.compare = null;
    this.preview = null;
    this.previewShown = false;
    this.galleryRevision = 0;
    this.previewGallery = false;
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

  get pane(): EdithaEditorPane {
    return this.renderRoot.querySelector('editha-editor-pane') as EdithaEditorPane;
  }
  get tree(): EdithaFileTree {
    return this.renderRoot.querySelector('editha-file-tree') as EdithaFileTree;
  }
  get dialog(): EdithaDialog {
    return this.renderRoot.querySelector('editha-dialog') as EdithaDialog;
  }
  get side(): EdithaSidePane | null {
    // Chiamato anche dal costruttore, prima del primo render.
    return (this.renderRoot?.querySelector('editha-side-pane') ?? null) as EdithaSidePane | null;
  }

  /** Colonna su cui agiscono barra e scorciatoie: quella usata per ultima. */
  get editor(): EdithaEditorPane {
    const side = this.side;
    return this.split && this.sideFocused && side?.shown ? side : this.pane;
  }

  /** Tab della colonna in uso. */
  focusedTab(): EditorTab | null {
    if (this.previewShown) return null;
    const side = this.side;
    return this.split && this.sideFocused && side?.shown ? side.shown : this.tabs.active;
  }

  get menu(): EdithaContextMenu {
    return this.renderRoot.querySelector('editha-context-menu') as EdithaContextMenu;
  }
  get toasts(): EdithaToasts {
    return this.renderRoot.querySelector('editha-toasts') as EdithaToasts;
  }

  // ——— ciclo di vita ———

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('keydown', this.keys.onKeyDown, true);
    window.addEventListener('keydown', this.keys.onEscape);
    window.addEventListener('beforeunload', this.keys.onBeforeUnload);
    document.addEventListener('visibilitychange', this.drafts.onVisibility);
    window.addEventListener('pagehide', this.drafts.onPageHide);
    window.addEventListener('pageshow', this.drafts.onPageShow);
    connection.addEventListener('change', this.server.onConnection);
    this.offLang = onLangChange(() => this.onLanguageChanged());
    this.narrowQuery.addEventListener('change', this.onNarrowChange);
    this.toggleAttribute('narrow', this.narrow);
  }

  override disconnectedCallback(): void {
    window.removeEventListener('keydown', this.keys.onKeyDown, true);
    window.removeEventListener('keydown', this.keys.onEscape);
    window.removeEventListener('beforeunload', this.keys.onBeforeUnload);
    document.removeEventListener('visibilitychange', this.drafts.onVisibility);
    window.removeEventListener('pagehide', this.drafts.onPageHide);
    window.removeEventListener('pageshow', this.drafts.onPageShow);
    connection.removeEventListener('change', this.server.onConnection);
    this.offLang?.();
    this.server.stop();
    this.drafts.stop();
    this.narrowQuery.removeEventListener('change', this.onNarrowChange);
    super.disconnectedCallback();
  }

  override async firstUpdated(): Promise<void> {
    this.server.build = await api.health().then((h) => h.build, () => null);
    try {
      this.settings = await api.settings();
    } catch {
      this.toasts.show(t('settings.unavailable'), 'warning');
    }
    this.applyTheme(this.settings.theme);
    setLang(resolveLang(this.settings.language));
    haData.setHints(this.settings.haHints);
    this.side!.makeState = (tab) => this.splitView.mirrorState(tab);
    this.refreshToolbar();
    this.drafts.startAlive();
    await this.drafts.recoverDrafts();
    // Entità arrivate o aiuti accesi/spenti: il riquadro del pannello Inserisci si aggiorna.
    haData.subscribe(() => {
      const tab = this.focusedTab();
      const s = this.editor.viewState;
      if (tab && s) this.updateInsertDetail(tab, s, s.selection.main.head);
      else this.insertDetail = null;
    });
    void haData.start();
    void this.snippets.loadSnippets();
  }

  // ——— lingua ———

  async languageMenu(rect?: DOMRect): Promise<void> {
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

  private renderBanner() {
    if (!this.offline && !this.addonUpdated) return null;
    const text = this.addonUpdated
      ? t('conn.updated')
      : t('conn.offline');
    return html`<div class="banner ${this.addonUpdated ? 'info' : ''}" role="alert">
      <span>${text}</span>
      <button class="btn primary" @click=${() => void this.server.reloadPage()}>${t('conn.reload')}</button>
    </div>`;
  }

  private readonly onNarrowChange = (e: MediaQueryListEvent) => {
    this.narrow = e.matches;
    this.drawerOpen = false;
    if (this.narrow) this.splitView.closeSplit();
    this.toggleAttribute('narrow', this.narrow);
    // Lo schema non si aggiorna su schermo stretto: tornando larghi si ricalcola.
    this.outlineView.outlineDoc = null;
    this.refreshStatus();
  };

  // ——— impostazioni ———

  private applyTheme(theme: ThemeMode): void {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }

  async updateSettings(changes: Partial<Settings>): Promise<void> {
    this.settings = { ...this.settings, ...changes };
    this.refreshToolbar();
    try {
      this.settings = await api.updateSettings(changes);
    } catch (err) {
      this.toasts.show(t('settings.notSaved', { error: this.errorText(err) }), 'error');
    }
  }

  async cycleTheme(): Promise<void> {
    const order: ThemeMode[] = ['auto', 'light', 'dark'];
    const next = order[(order.indexOf(this.settings.theme) + 1) % order.length]!;
    this.applyTheme(next);
    await this.updateSettings({ theme: next });
    this.toasts.show(t('theme.toast', { name: t(`theme.${next}`) }), 'info');
  }

  async toggleWordWrap(): Promise<void> {
    await this.updateSettings({ wordWrap: !this.settings.wordWrap });
    const prefs = { wordWrap: this.settings.wordWrap, fontSize: this.settings.fontSize };
    for (const tab of this.tabs.tabs) this.applyEffects(tab, reconfigureEffects({ prefs }));
  }

  /** Aiuti di Home Assistant: il controllo delle entità riparte da solo (cambia l'elenco usato). */
  async toggleHaHints(): Promise<void> {
    const on = !this.settings.haHints;
    haData.setHints(on);
    await this.updateSettings({ haHints: on });
    this.toasts.show(t(on ? 'haHints.on' : 'haHints.off'), 'info');
  }

  toggleSidebar(): void {
    if (this.narrow) {
      this.drawerOpen = !this.drawerOpen;
      return;
    }
    void this.updateSettings({ sidebarVisible: !this.settings.sidebarVisible });
  }

  // ——— tab ———

  /** Legge un file e crea la sua tab (senza attivarla se `background`). */
  async loadTab(
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

  activate(path: string): void {
    const tab = this.tabs.activate(path);
    if (!tab) return;
    // Scegliendo una tab si torna all'editor; la tab di anteprima resta.
    this.previewShown = false;
    this.pane.show(tab);
    this.refreshTabs();
    this.refreshStatus();
    this.session.scheduleSession();
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
      if (choice === 'save' && (!(await this.saver.save(tab)) || tab.dirty)) return false;
    }
    // Lo stato della tab chiusa viene staccato dalla vista prima di scegliere la successiva:
    // l'editor mostra sempre il contenuto della nuova tab attiva (ED-4, FEP #19).
    this.pane.detach(tab);
    if (this.side?.shown === tab) {
      this.side.detach(tab);
      this.side.showEmpty();
    }
    this.drafts.dropDraft(tab.path, tab);
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
    this.session.scheduleSession();
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
      this.drafts.scheduleDraft(tab, 1000, update.transactions.some((tr) => tr.docChanged && !tr.annotation(programmatic)));
      this.ha.scheduleTemplate(tab);
    }
    if (tab !== this.tabs.active) return;
    this.refreshStatus(update.state);
    this.refreshToolbar(update.state);
    if (update.selectionSet || update.docChanged) this.session.scheduleSession();
  }

  // ——— confronto tra due file (BK-6) ———

  /** Testo da confrontare: quello della tab aperta (anche non salvato) o quello su disco. */
  async compareSide(path: string): Promise<CompareSide | null> {
    const tab = this.tabs.find(path);
    if (tab) return { path, content: docText(this.pane.stateOf(tab)) };
    try {
      return { path, content: (await api.read(path)).content };
    } catch (err) {
      this.toasts.show(this.openErrorText(path, err), 'error');
      return null;
    }
  }

  async openCompare(a: string, b: string): Promise<void> {
    const left = await this.compareSide(a);
    const right = left && (await this.compareSide(b));
    if (!left || !right) return;
    if (this.narrow) this.drawerOpen = false;
    this.history = null;
    this.previewShown = false;
    this.compare = { left, right };
  }

  closeCompare(): void {
    this.compare = null;
    this.ha.scheduleTemplate(null);
  }

  // ——— anteprima di immagini e PDF (FS-10) ———

  /** FS-11: le immagini di una cartella in griglia, nella stessa tab dell'anteprima. */
  openGallery(path: string): void {
    this.openSeq++;
    this.openPreview(path, true);
  }

  /** Apre un'immagine o un PDF nella tab di anteprima, che è una sola e viene riusata. */
  private openPreview(path: string, gallery = false): void {
    this.previewGallery = gallery;
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

  closePreview(): void {
    this.preview = null;
    this.previewShown = false;
    this.refreshToolbar();
    this.refreshStatus();
  }

  // ——— salvataggio (ED-5, SEC-4): in SaveController ———

  save(tab?: EditorTab | null): Promise<boolean> {
    return this.saver.save(tab);
  }

  saveAll(): Promise<void> {
    return this.saver.saveAll();
  }

  // ——— vista divisa (ED-17) ———

  /** Effetti di configurazione per la tab e, se la mostra, per la colonna destra. */
  applyEffects(tab: EditorTab, effects: StateEffect<unknown>[]): void {
    this.pane.apply(tab, effects);
    this.side?.apply(tab, effects);
  }

  /** Testo sostituito (ricarica, bozza recuperata): anche la colonna destra si riallinea. */
  replaceDoc(tab: EditorTab, text: string): void {
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
            if (tab) void this.splitView.showInSide(tab);
          }}
        >
          ${shown ? null : html`<option value="" selected>${t('split.choose')}</option>`}
          ${this.tabViews.map(
            (v) => html`<option value=${v.path} ?selected=${v.path === shown?.path}>${v.dirty ? '● ' : ''}${v.path}</option>`,
          )}
        </select>
        <button class="icon-btn small" title=${t('split.close')} @click=${() => this.splitView.closeSplit()}>
          ${icon(icons.close, 16)}
        </button>
      </div>
      <editha-side-pane @side-change=${(e: CustomEvent<{ tab: EditorTab; changes: ChangeSet }>) => this.splitView.onSideChange(e)}>
        <div class="side-empty" slot="empty">${t('split.empty')}</div>
      </editha-side-pane>
    </div>`;
  }

  // ——— stato visualizzato ———

  refreshTabs(): void {
    this.tabViews = this.tabs.tabs.map((t) => ({ path: t.path, name: t.name, dirty: t.dirty, readOnly: t.readOnly }));
    this.activePath = this.tabs.active?.path ?? null;
    this.refreshToolbar();
  }

  /** Riquadro dell'entità nel pannello Inserisci: solo se il pannello è aperto e gli aiuti accesi. */
  private updateInsertDetail(tab: EditorTab, s: EditorState, head: number): void {
    const ctx =
      this.insertOpen && languageOf(tab.path).id === 'yaml' ? detailAtPos(s, head, true) : null;
    const next = ctx ? { ctx, line: s.doc.lineAt(head).number } : null;
    // Lo stesso contenuto non ridisegna il pannello a ogni tasto.
    if (JSON.stringify(next) !== JSON.stringify(this.insertDetail ?? null)) this.insertDetail = next;
  }

  refreshStatus(state?: EditorState): void {
    // Cursore spostato, altra tab o altra colonna: l'anteprima segue il template sotto il cursore.
    this.ha.scheduleTemplate(null);
    const tab = this.focusedTab();
    if (!tab) {
      this.status = null;
      this.insertDetail = null;
      this.outlineView.updateOutline(null, null);
      return;
    }
    const onSide = tab !== this.tabs.active || (this.split && this.sideFocused);
    const s = (onSide ? this.side?.viewState : null) ?? state ?? this.pane.stateOf(tab);
    this.outlineView.updateOutline(tab, s);
    const head = s.selection.main.head;
    this.updateInsertDetail(tab, s, head);
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
      historyOpen: !!this.history,
      haHints: this.settings.haHints,
    };
  }

  refreshToolbar(state?: EditorState): void {
    this.toolbar = this.computeToolbar(state);
  }

  /** Conferma breve di un'operazione riuscita. */
  flash(message: string): void {
    this.toasts.show(message, 'success');
  }

  errorText(err: unknown): string {
    return errorText(err);
  }

  openErrorText(path: string, err: unknown): string {
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

  override willUpdate(changed: Map<PropertyKey, unknown>): void {
    // Il pulsante Cronologia della barra mostra se la cronologia è aperta.
    if (changed.has('history') && this.toolbar && this.toolbar.historyOpen !== !!this.history) this.refreshToolbar();
  }

  override render() {
    const showSidebar = this.narrow ? this.drawerOpen : this.settings.sidebarVisible;
    return html`
      <editha-toolbar
        .state=${this.toolbar}
        @toolbar-action=${(e: CustomEvent<{ action: string; rect?: DOMRect }>) => this.keys.onToolbarAction(e)}
      ></editha-toolbar>
      ${this.renderBanner()}
      <div class="body">
        <aside style="width:${this.settings.sidebarWidth}px" ?hidden=${!showSidebar}>
          <editha-search-panel
            ?hidden=${!this.searchOpen}
            @search-close=${() => this.search.closeSearch()}
            @search-replace=${(e: Parameters<SearchController['replaceInFiles']>[0]) => void this.search.replaceInFiles(e)}
            @search-open=${(e: CustomEvent<{ path: string; match: SearchMatch }>) =>
              void this.search.openSearchResult(e.detail.path, e.detail.match)}
          ></editha-search-panel>
          <editha-git-panel
            ?hidden=${!this.gitOpen}
            @git-close=${() => this.git.closeGit()}
            @git-open=${(e: CustomEvent<{ path: string }>) => void this.openFile(e.detail.path)}
            @git-diff=${(e: CustomEvent<{ path: string; deleted: boolean }>) =>
              void this.git.openGitDiff(e.detail.path, e.detail.deleted)}
            @git-rev-diff=${(e: CustomEvent<{ path: string; rev: string }>) =>
              void this.git.openGitRevDiff(e.detail.path, e.detail.rev)}
            @git-restore=${(e: CustomEvent<{ path: string; rev: string; subject: string }>) =>
              void this.git.restoreFromGit(e.detail.path, e.detail.rev, e.detail.subject)}
            @git-changed=${(e: CustomEvent<{ message: string }>) => void this.git.afterGitChange(e.detail.message)}
            @git-error=${(e: CustomEvent<{ message: string }>) => this.toasts.show(e.detail.message, 'error')}
          ></editha-git-panel>
          <editha-file-tree
            ?hidden=${this.searchOpen || this.gitOpen}
            .activePath=${this.previewShown ? this.preview : this.activePath}
            .showSystem=${this.settings.showSystem}
            @file-open=${(e: CustomEvent<{ path: string }>) => void this.openFile(e.detail.path)}
            @tree-context=${(e: CustomEvent<{ entry: Entry | null; x: number; y: number }>) =>
              void this.fileOps.onTreeContext(e)}
            @tree-action=${(e: CustomEvent<{ action: string }>) => this.fileOps.onTreeAction(e)}
            @files-drop=${(e: CustomEvent<{ dir: string; files: File[] }>) =>
              void this.fileOps.uploadFiles(e.detail.dir, e.detail.files)}
            @dir-changed=${(e: CustomEvent<{ dir: string | null }>) => {
              if (this.preview && this.previewGallery && (e.detail.dir === null || e.detail.dir === this.preview)) {
                this.galleryRevision++;
              }
            }}
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
              @compare-close=${() => this.closeCompare()}
            ></editha-compare-panel>`
          : null}
        ${this.history
          ? html`<editha-history-panel
              .path=${this.history.path}
              .current=${this.history.current}
              .prefs=${{ wordWrap: this.settings.wordWrap, fontSize: this.settings.fontSize }}
              .canRestore=${!this.history.readOnly}
              @history-close=${() => this.versions.closeHistory()}
              @history-space=${() => void this.versions.openHistorySpace()}
              @history-restore=${(e: CustomEvent<{ id: string; date: string }>) =>
                void this.versions.restoreVersion(e.detail.id, e.detail.date)}
            ></editha-history-panel>`
          : null}
        <main>
          <editha-tab-bar
            ?hidden=${this.tabViews.length === 0 && !this.preview}
            .tabs=${this.tabViews}
            .active=${this.previewShown ? this.preview : this.activePath}
            .preview=${this.preview}
            .previewFolder=${this.previewGallery}
            @tab-activate=${(e: CustomEvent<{ path: string }>) => {
              // La tab scelta va nella colonna sinistra: pulsanti e scorciatoie agiscono su di lei.
              this.sideFocused = false;
              this.activate(e.detail.path);
            }}
            @tab-close=${(e: CustomEvent<{ path: string }>) => void this.closeTab(e.detail.path)}
            @preview-activate=${() => this.showPreview()}
            @preview-close=${() => this.closePreview()}
          ></editha-tab-bar>
          <div
            class="editors"
            @editha-link=${(e: CustomEvent<{ kind: LinkKind; target: string; file: string }>) => void this.search.followLink(e)}
          >
          <editha-editor-pane>
            <div class="welcome" slot="empty">
              <div class="keys">
                <span><kbd>${KEY.mod}</kbd> + <kbd>S</kbd></span><span>${t('welcome.save')}</span>
                <span><kbd>${KEY.mod}</kbd> + <kbd>${KEY.alt}</kbd> + <kbd>S</kbd></span><span>${t('welcome.saveAll')}</span>
                <span><kbd>${KEY.mod}</kbd> + <kbd>F</kbd></span><span>${t('welcome.search')}</span>
                <span><kbd>${KEY.alt}</kbd> + <kbd>W</kbd></span><span>${t('welcome.closeTab')}</span>
                <span><kbd>Tab</kbd> / <kbd>${KEY.shift}</kbd> + <kbd>Tab</kbd></span><span>${t('welcome.indent')}</span>
                <span><kbd>Ctrl</kbd> + <kbd>Space</kbd></span><span>${t('welcome.complete')}</span>
                <span><kbd>F2</kbd></span><span>${t('welcome.rename')}</span>
                <span><kbd>${KEY.alt}</kbd> + <kbd>T</kbd></span><span>${t('welcome.template')}</span>
              </div>
            </div>
          </editha-editor-pane>
          ${this.renderSide()}
          ${this.settings.outlineVisible && !this.narrow
            ? html`<editha-outline-panel
                .items=${this.outline}
                .active=${this.outlineActive}
                .file=${this.outline ? (this.outlineView.outlineTab?.path ?? null) : null}
                @outline-go=${(e: CustomEvent<{ line: number }>) => this.editor.goToLine(e.detail.line, 'start')}
                @outline-close=${() => void this.outlineView.toggleOutline()}
              ></editha-outline-panel>`
            : null}
          ${this.preview && this.previewShown && this.previewGallery
            ? html`<editha-gallery-panel
                .path=${this.preview}
                .revision=${this.galleryRevision}
                @preview-download=${(e: CustomEvent<{ path: string }>) => this.fileOps.download(e.detail.path)}
                @preview-close=${() => this.closePreview()}
                @gallery-context=${(e: CustomEvent<{ entry: Entry; x: number; y: number }>) => void this.fileOps.onTreeContext(e)}
              ></editha-gallery-panel>`
            : this.preview && this.previewShown
            ? html`<editha-preview-panel
                .path=${this.preview}
                @preview-download=${(e: CustomEvent<{ path: string }>) => this.fileOps.download(e.detail.path)}
                @preview-close=${() => this.closePreview()}
              ></editha-preview-panel>`
            : null}
          </div>
          ${this.template
            ? html`<editha-template-panel
                .view=${this.template.view}
                .file=${this.template.file}
                .line=${this.template.line}
                .updating=${this.template.updating}
                @template-refresh=${() => void this.ha.previewTemplate()}
                @template-close=${() => this.ha.closeTemplate()}
                @template-goto=${(e: CustomEvent<{ line: number }>) => void this.ha.templateGoTo(e.detail.line)}
                @template-copy-failed=${() => this.toasts.show(t('copy.failed'), 'warning')}
              ></editha-template-panel>`
            : null}
          ${this.insertOpen
            ? html`<editha-insert-panel
                .tab=${this.insertTab}
                .userSnippets=${this.userSnippets}
                .canInsert=${!!this.focusedTab() && !this.focusedTab()!.readOnly}
                .detail=${this.insertDetail}
                @insert-text=${(e: CustomEvent<{ text: string }>) => this.snippets.insertText(e.detail.text)}
                @insert-detail=${(e: CustomEvent<{ label: string; kind: 'state' | 'attribute' }>) =>
                  this.snippets.insertDetail(e.detail.label, e.detail.kind)}
                @insert-snippet=${(e: CustomEvent<{ body: string; fields: boolean }>) =>
                  this.snippets.insertSnippet(e.detail.body, e.detail.fields)}
                @snippet-save=${() => void this.snippets.saveSelectionAsSnippet()}
                @snippet-edit=${(e: CustomEvent<{ id: string }>) => void this.snippets.editSnippet(e.detail.id)}
                @snippet-delete=${(e: CustomEvent<{ id: string; name: string }>) =>
                  void this.snippets.deleteSnippet(e.detail.id, e.detail.name)}
                @panel-close=${() => this.snippets.toggleInsert()}
                @entity-usages=${(e: CustomEvent<{ id: string }>) =>
                  void this.search.openSearch({ query: e.detail.id, wholeWord: true, caseSensitive: true })}
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
          void this.fileOps.uploadFiles(this.fileOps.uploadDir, files);
        }}
      />
      <editha-dialog></editha-dialog>
      <editha-context-menu></editha-context-menu>
      <editha-about-dialog></editha-about-dialog>
      <editha-history-space @history-pruned=${() => void this.versions.afterHistoryPruned()}></editha-history-space>
      <editha-folder-picker></editha-folder-picker>
      <editha-snippet-editor></editha-snippet-editor>
      <editha-toasts></editha-toasts>
    `;
  }
}

customElements.define('editha-app', EdithaApp);
