import { api } from '../api/client.js';
import type { SearchMatch } from '../api/types.js';
import { t } from '../i18n/index.js';
import type { LinkKind } from '../editor/links.js';
import { basename, dirname, resolvePath } from '../state/paths.js';
import { secretKeys } from '../state/secrets.js';
import type { EdithaApp } from '../components/app.js';
import {
  ENTITY_ID,
  replaceConfirmMessage,
  replaceDoneMessage,
  replaceSkippedMessage,
  type EdithaSearchPanel,
  type SearchRequest,
} from '../components/search-panel.js';

/** Ricerca e sostituzione in tutti i file, e collegamenti !include / !secret che portano a un altro file. */
export class SearchController {
  constructor(private readonly app: EdithaApp) {}

  // ——— ricerca in tutti i file (SR-1, SR-2, SR-4) ———

  private get searchPanel(): EdithaSearchPanel {
    return this.app.renderRoot.querySelector('editha-search-panel') as EdithaSearchPanel;
  }

  /**
   * Apre la ricerca nella barra laterale. Senza richiesta parte dal testo selezionato,
   * o dall'entity_id sotto il cursore (in quel caso cerca dove è usata l'entità).
   */
  async openSearch(req?: SearchRequest): Promise<void> {
    if (this.app.narrow) this.app.drawerOpen = true;
    else if (!this.app.settings.sidebarVisible) await this.app.updateSettings({ sidebarVisible: true });
    this.app.searchOpen = true;
    this.app.gitOpen = false;
    this.app.refreshToolbar();
    await this.app.updateComplete;
    if (!req && this.app.focusedTab()) {
      const selected = this.app.editor.selectedText();
      if (selected && !selected.includes('\n')) req = { query: selected };
      else {
        const word = this.app.editor.wordAtCursor();
        if (ENTITY_ID.test(word)) req = { query: word, wholeWord: true, caseSensitive: true };
      }
    }
    if (req) this.searchPanel.searchFor(req);
    else this.searchPanel.focusInput();
  }

  closeSearch(): void {
    this.app.searchOpen = false;
    this.app.refreshToolbar();
  }

  /** SR-3: sostituzione nei file trovati, dopo conferma; i file con modifiche non salvate si saltano. */
  async replaceInFiles(
    e: CustomEvent<{ paths: string[]; counts: Record<string, number>; request: SearchRequest; replacement: string; truncated: boolean }>,
  ): Promise<void> {
    const { request, replacement, counts, truncated } = e.detail;
    const dirty = e.detail.paths.filter((p) => this.app.tabs.find(p)?.dirty);
    const paths = e.detail.paths.filter((p) => !dirty.includes(p));
    if (paths.length === 0) {
      this.app.toasts.show(t('replace.allDirty'), 'warning');
      return;
    }
    const ok = await this.app.dialog.confirm({
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
      this.app.toasts.show(t('replace.failed', { error: this.app.errorText(err) }), 'error');
      return;
    }
    // Le tab aperte (senza modifiche) mostrano subito il testo nuovo.
    for (const f of res.files) {
      const tab = this.app.tabs.find(f.path);
      if (tab && !tab.dirty) await this.app.saver.reloadFromDisk(tab, true);
    }
    const count = res.files.reduce((n, f) => n + f.count, 0);
    this.app.flash(replaceDoneMessage(count, res.files.length));
    if (res.skipped.length) this.app.toasts.show(replaceSkippedMessage(res.skipped.length), 'warning');
    await this.searchPanel.rerun();
  }

  async openSearchResult(path: string, match: SearchMatch): Promise<void> {
    await this.app.openFile(path);
    if (this.app.tabs.active?.path === path) this.app.pane.selectMatch(match.line, match.column, match.length);
  }


  // ——— collegamenti: !include e !secret (HA-4, HA-5) ———

  async followLink(e: CustomEvent<{ kind: LinkKind; target: string; file: string }>): Promise<void> {
    const { kind, target, file } = e.detail;
    if (kind === 'secret') {
      const key = (await secretKeys(file)).find((k) => k.key === target);
      if (!key) {
        this.app.toasts.show(t('link.secretMissing', { key: target }), 'warning');
        return;
      }
      await this.app.openFile(key.path);
      if (this.app.tabs.active?.path === key.path) this.app.pane.goToLine(key.line);
      return;
    }
    // Come in HA, il percorso è relativo alla cartella del file che contiene l'include.
    const path = resolvePath(dirname(file), target);
    // '' è /config stessa: va bene solo per una cartella (!include_dir_… ..), non per un file.
    if (path === null || (path === '' && kind === 'include')) {
      this.app.toasts.show(t('link.outside', { path: target }), 'warning');
      return;
    }
    if (kind === 'include') {
      await this.app.openFile(path);
      return;
    }
    // !include_dir_…: si mostra la cartella nell'albero.
    if (this.app.narrow) this.app.drawerOpen = true;
    else if (!this.app.settings.sidebarVisible) await this.app.updateSettings({ sidebarVisible: true });
    await this.app.updateComplete;
    if (path === '') return;
    if (!(await this.app.tree.reveal(path, 'directory', true))) this.app.toasts.show(t('link.dirMissing', { path }), 'warning');
  }
}
