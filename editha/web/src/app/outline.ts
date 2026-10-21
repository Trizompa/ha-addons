import type { EditorState } from '@codemirror/state';
import { languageOf } from '../editor/languages.js';
import { activeOutlineIndex, buildOutline } from '../editor/outline.js';
import type { EdithaApp } from '../components/app.js';
import type { EditorTab } from '../components/editor-pane.js';

/** Schema del file YAML (ED-18): si ricalcola mentre si scrive e segue il cursore. */
export class OutlineController {
  constructor(private readonly app: EdithaApp) {}

  /** Testo per cui è stato calcolato lo schema (null: va ricalcolato) e tab da cui viene. */
  outlineDoc: unknown = null;
  outlineTab: EditorTab | null = null;
  private outlineTimer: ReturnType<typeof setTimeout> | undefined;

  /** Ricalcola lo schema quando cambia il testo (con un attimo di pausa mentre si scrive). */
  updateOutline(tab: EditorTab | null, s: EditorState | null): void {
    if (!this.app.settings.outlineVisible || this.app.narrow) return;
    if (!tab || !s || languageOf(tab.path).id !== 'yaml') {
      clearTimeout(this.outlineTimer);
      this.outlineDoc = null;
      this.app.outline = null;
      this.app.outlineActive = -1;
      return;
    }
    const line = s.doc.lineAt(s.selection.main.head).number;
    if (s.doc !== this.outlineDoc) {
      // Altro file: subito; stesso file mentre si scrive: dopo una breve pausa.
      const fresh = this.outlineDoc === null || this.app.outline === null || this.outlineTab !== tab;
      this.outlineDoc = s.doc;
      this.outlineTab = tab;
      clearTimeout(this.outlineTimer);
      if (fresh) {
        this.app.outline = buildOutline(s.doc.toString());
      } else {
        this.outlineTimer = setTimeout(() => {
          this.app.outline = buildOutline(s.doc.toString());
          // Il cursore può essersi spostato nel frattempo: la voce attiva si rilegge adesso.
          this.app.refreshStatus();
        }, 300);
      }
    }
    if (this.app.outline) this.app.outlineActive = activeOutlineIndex(this.app.outline, line);
  }

  async toggleOutline(): Promise<void> {
    const visible = !this.app.settings.outlineVisible;
    await this.app.updateSettings({ outlineVisible: visible });
    this.outlineDoc = null;
    this.app.refreshStatus();
  }
}
