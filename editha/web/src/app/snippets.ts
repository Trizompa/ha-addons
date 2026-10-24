import { api } from '../api/client.js';
import type { Snippet } from '../api/types.js';
import { t } from '../i18n/index.js';
import { fillIds, normalizeSnippetBody } from '../editor/snippets.js';
import { detailAtPos, linesAround } from '../editor/ha-complete.js';
import { insertText, valueAt } from '../editor/ha-detail.js';
import type { EdithaApp } from '../components/app.js';
import type { EdithaInsertPanel } from '../components/insert-panel.js';
import type { EdithaSnippetEditor } from '../components/snippet-editor.js';

/** Pannello Inserisci: entità e snippet nell'editor, snippet dell'utente salvati sul server. */
export class SnippetsController {
  constructor(private readonly app: EdithaApp) {}

  // ——— inserimento di entità e snippet ———

  toggleInsert(): void {
    this.app.insertOpen = !this.app.insertOpen;
    this.app.refreshToolbar();
    this.app.refreshStatus();
    if (this.app.insertOpen) {
      void this.app.updateComplete.then(() =>
        (this.app.renderRoot.querySelector('editha-insert-panel') as EdithaInsertPanel | null)?.focusSearch(),
      );
    }
  }

  insertText(text: string): void {
    if (!this.app.editor.insertText(text)) this.app.toasts.show(t('insert.needEditable'), 'warning');
  }

  /**
   * Stato o attributo dal riquadro dell'entità (HA-12). Sulla riga di «state:» / «attribute:» il
   * valore prende il posto di quello scritto (tutto, virgolette comprese), tra virgolette se serve;
   * in un template sostituisce la parte iniziata; altrove si inserisce così com'è.
   */
  insertDetail(label: string, kind: 'state' | 'attribute'): void {
    const editor = this.app.editor;
    const s = editor.viewState;
    let ok = false;
    if (s) {
      const head = s.selection.main.head;
      const around = linesAround(s, head);
      const value = valueAt(around.lines, around.index, around.before.length);
      const ctx = value ? null : detailAtPos(s, head);
      if (value && value.ctx.kind === kind) {
        const text = (value.space ? ' ' : '') + insertText(value.ctx, label);
        ok = editor.replaceRange(around.lineFrom + value.from, around.lineFrom + value.to, text);
      } else if (ctx && ctx.kind === kind) {
        ok = editor.replaceBefore(ctx.typed, insertText(ctx, label));
      } else {
        ok = editor.insertText(label);
      }
    }
    if (!ok) this.app.toasts.show(t('insert.needEditable'), 'warning');
  }

  insertSnippet(body: string, fields: boolean): void {
    if (!this.app.editor.insertBlock(fillIds(body), fields)) {
      this.app.toasts.show(t('insert.needEditable'), 'warning');
      return;
    }
    if (fields) this.app.toasts.show(t('insert.fieldsHint'), 'info');
  }

  async loadSnippets(): Promise<void> {
    try {
      this.app.userSnippets = (await api.snippets()).snippets;
    } catch {
      this.app.userSnippets = [];
    }
  }

  private async saveSnippets(list: Snippet[]): Promise<boolean> {
    try {
      this.app.userSnippets = (await api.saveSnippets({ snippets: list })).snippets;
      return true;
    } catch (err) {
      this.app.toasts.show(t('snippet.notSaved', { error: this.app.errorText(err) }), 'error');
      return false;
    }
  }

  async saveSelectionAsSnippet(): Promise<void> {
    const selection = this.app.editor.selectionForSnippet();
    const body = normalizeSnippetBody(selection.text, selection.column);
    if (!body.trim()) {
      this.app.toasts.show(t('snippet.selectFirst'), 'warning');
      return;
    }
    if (body.length > 20000) {
      this.app.toasts.show(t('snippet.tooLong'), 'warning');
      return;
    }
    const name = await this.app.dialog.prompt({
      title: t('snippet.newTitle'),
      label: t('snippet.nameLabel'),
      confirmLabel: t('common.save'),
      validate: (v) => (v.trim() ? (v.length > 120 ? t('name.tooLong') : null) : t('name.empty')),
    });
    if (name === null) return;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const trimmed = name.trim();
    if (await this.saveSnippets([...this.app.userSnippets, { id, name: trimmed, body }])) {
      this.app.flash(t('snippet.saved', { name: trimmed }));
    }
  }

  async editSnippet(id: string): Promise<void> {
    const snippet = this.app.userSnippets.find((s) => s.id === id);
    if (!snippet) return;
    const editor = this.app.renderRoot.querySelector('editha-snippet-editor') as EdithaSnippetEditor;
    const changed = await editor.edit(snippet);
    if (!changed) return;
    const list = this.app.userSnippets.map((s) => (s.id === id ? { ...s, ...changed } : s));
    if (await this.saveSnippets(list)) this.app.flash(t('snippet.saved', { name: changed.name }));
  }

  async deleteSnippet(id: string, name: string): Promise<void> {
    const ok = await this.app.dialog.confirm({
      title: t('snippet.deleteTitle'),
      message: t('snippet.deleteMessage', { name }),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (ok && (await this.saveSnippets(this.app.userSnippets.filter((s) => s.id !== id)))) this.app.flash(t('snippet.deleted'));
  }
}
