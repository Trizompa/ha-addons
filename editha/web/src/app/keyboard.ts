import { whileLeaving } from '../api/client.js';
import { shortcutKey } from '../state/keys.js';
import type { EdithaApp } from '../components/app.js';
import type { EdithaAboutDialog } from '../components/about-dialog.js';

/** Comandi dalla barra degli strumenti, scorciatoie da tastiera e uscita dalla pagina. */
export class KeyboardController {
  constructor(private readonly app: EdithaApp) {}

  // ——— barra degli strumenti ———

  onToolbarAction(e: CustomEvent<{ action: string; rect?: DOMRect }>): void {
    switch (e.detail.action) {
      case 'toggle-sidebar':
        return this.app.toggleSidebar();
      case 'save':
        return void this.app.saver.save();
      case 'save-all':
        return void this.app.saver.saveAll();
      case 'undo':
        return this.app.editor.command('undo');
      case 'redo':
        return this.app.editor.command('redo');
      case 'search':
        return this.app.editor.command('search');
      case 'search-all':
        return this.app.searchOpen ? this.app.search.closeSearch() : void this.app.search.openSearch();
      case 'split':
        return void (this.app.split ? this.app.splitView.closeSplit() : this.app.tabs.active && this.app.splitView.showInSide(this.app.tabs.active));
      case 'about':
        return (this.app.renderRoot.querySelector('editha-about-dialog') as EdithaAboutDialog).show();
      case 'history':
        // Secondo clic: chiude, come gli altri pulsanti della barra.
        if (this.app.history) return this.app.versions.closeHistory();
        return void (this.app.focusedTab() && this.app.versions.openHistory(this.app.focusedTab()!.path));
      case 'word-wrap':
        return void this.app.toggleWordWrap();
      case 'outline':
        return void this.app.outlineView.toggleOutline();
      case 'ha-hints':
        return void this.app.toggleHaHints();
      case 'theme':
        return void this.app.cycleTheme();
      case 'insert':
        return this.app.snippets.toggleInsert();
      case 'template':
        return void this.app.ha.previewTemplate();
      case 'ha-menu':
        return void this.app.ha.haMenu(e.detail.rect);
      case 'language':
        return void this.app.languageMenu(e.detail.rect);
    }
  }

  // ——— tastiera e uscita ———

  readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = shortcutKey(e);
    // Con una finestra aperta (dialogo, scelta della cartella, snippet, informazioni) le
    // scorciatoie non agiscono sui file sotto di lei.
    const modal = () =>
      this.app.dialog.busy || e.composedPath().some((n) => n instanceof HTMLDialogElement && n.open);
    if (mod && e.shiftKey && key === 'f') {
      e.preventDefault();
      void this.app.search.openSearch();
    } else if (mod && key === 's') {
      e.preventDefault();
      if (modal()) return;
      if (e.altKey) void this.app.saver.saveAll();
      else void this.app.saver.save();
    } else if (e.altKey && !mod && key === 't') {
      // In un campo di testo Alt+T resta un carattere (su Mac Option+T scrive †).
      const target = e.composedPath()[0];
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      e.preventDefault();
      if (modal()) return;
      void this.app.ha.previewTemplate();
    } else if (e.altKey && !mod && key === 'w') {
      // In un campo di testo Alt+W resta un carattere (su Mac Option+W scrive ∑).
      const target = e.composedPath()[0];
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      e.preventDefault();
      if (modal()) return;
      const tab = this.app.focusedTab();
      if (this.app.previewShown) this.app.closePreview();
      else if (tab) void this.app.closeTab(tab.path);
    }
  };

  /**
   * Esc chiude cronologia, confronto o anteprima. Ascoltato dopo i pannelli: un Esc dato in un
   * campo (ricerca, filtro, pannello Inserisci) vale per quel campo e basta.
   */
  readonly onEscape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented || this.app.dialog.busy || this.app.menu.items) return;
    const path = e.composedPath();
    if (path.some((n) => n instanceof HTMLDialogElement && n.open)) return;
    const target = path[0];
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
    if (this.app.history) this.app.versions.closeHistory();
    else if (this.app.compare) this.app.closeCompare();
    else if (this.app.previewShown) this.app.closePreview();
    else if (this.app.template) this.app.ha.closeTemplate();
    else return;
    e.preventDefault();
  };

  readonly onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (this.app.tabs.tabs.some((t) => t.dirty)) {
      e.preventDefault();
      // Chrome meno recenti e le WebView (app Companion di Home Assistant) guardano returnValue.
      e.returnValue = '';
    }
    whileLeaving(() => {
      this.app.drafts.flushDrafts();
      // Durante l'avvio la sessione non è ancora ripristinata: salvarla ora la cancellerebbe.
      if (this.app.session.sessionReady) void this.app.session.saveSession();
    });
  };
}
