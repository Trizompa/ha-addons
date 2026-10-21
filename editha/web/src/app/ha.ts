import { api, ApiError } from '../api/client.js';
import { t } from '../i18n/index.js';
import { languageOf } from '../editor/languages.js';
import { LINT_MAX_CHARS } from '../editor/yaml-lint.js';
import { JINJA, entitiesIn, syntaxErrorLine, templateAt, type TemplateSource } from '../editor/jinja-template.js';
import { haData } from '../state/ha-data.js';
import { isSecretsFile } from '../state/paths.js';
import { icons } from '../ui/icons.js';
import type { EdithaApp } from '../components/app.js';
import type { MenuEntry } from '../components/context-menu.js';
import type { EditorTab } from '../components/editor-pane.js';
import type { TemplateView } from '../components/template-panel.js';

/** Menu Home Assistant (verifica, ricarica, riavvio) e anteprima dei template. */
export class HaController {
  constructor(private readonly app: EdithaApp) {}

  // ——— Home Assistant: verifica, ricarica, riavvio (ACT-1, ACT-2, ACT-4) ———

  async haMenu(rect?: DOMRect): Promise<void> {
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
    const choice = await this.app.menu.show(items, x, y);
    if (choice === 'check') await this.haCheck();
    else if (choice === 'reload') await this.haReload();
    else if (choice === 'restart') await this.haRestart();
  }

  // ——— anteprima dei template (HA-7) ———

  /** Anteprima in corso: una risposta arrivata dopo un'altra richiesta (o dopo la chiusura) si ignora. */
  private templateRun = 0;

  /** Aggiornamento automatico dell'anteprima (HA-7): mentre si scrive e spostando il cursore. */
  private templateTimer: ReturnType<typeof setTimeout> | undefined;
  /** Il file dell'anteprima è stato modificato dall'ultimo aggiornamento. */
  private templateEdited = false;
  /** Ultimo template mandato: muovendosi dentro lo stesso template non si richiama HA. */
  private templateSent: { file: string; template: string; head: number; failed: boolean } | null = null;

  /**
   * Template selezionato o sotto il cursore in una tab (null in secrets.yaml e dove non c'è).
   * `live`: aggiornamento automatico, solo dal cursore (una selezione per copiare non si manda) e
   * non nei file molto grandi o senza nessun template.
   */
  private templateIn(tab: EditorTab | null, live = false): { tab: EditorTab; src: TemplateSource; head: number } | null {
    if (!tab || isSecretsFile(tab.path)) return null;
    const onSide = this.app.side?.shown === tab && (tab !== this.app.tabs.active || (this.app.split && this.app.sideFocused));
    const s = (onSide ? this.app.side?.viewState : null) ?? this.app.pane.stateOf(tab);
    if (live && s.doc.length > LINT_MAX_CHARS) return null;
    const doc = s.doc.toString();
    if (live && !JINJA.test(doc)) return null;
    const sel = s.selection.main;
    const src = live
      ? templateAt(doc, sel.head, sel.head, languageOf(tab.path).id)
      : templateAt(doc, sel.from, sel.to, languageOf(tab.path).id);
    return src ? { tab, src, head: sel.head } : null;
  }

  /**
   * Manda a Home Assistant il template selezionato o sotto il cursore e ne mostra il risultato.
   * `live`: aggiornamento automatico (dopo una modifica o uno spostamento del cursore). Non avvisa,
   * segue il cursore sul template su cui si trova e, se lì non ce n'è uno, tiene il risultato di prima
   * (dopo una modifica al file dell'anteprima ricalcola il template di quel file).
   */
  async previewTemplate(live = false): Promise<void> {
    if (live && !this.app.template) return;
    // Con cronologia o confronto aperti il pannello resterebbe nascosto sotto di loro.
    if (this.app.history || this.app.compare) {
      if (!live) this.app.toasts.show(t('template.covered'), 'warning');
      return;
    }
    let found: { tab: EditorTab; src: TemplateSource; head: number } | null;
    if (live) {
      const edited = this.templateEdited;
      this.templateEdited = false;
      found =
        this.templateIn(this.app.focusedTab(), true) ??
        (edited ? this.templateIn(this.app.tabs.find(this.app.template!.file) ?? null, true) : null);
      if (!found) return;
      const last = this.templateSent;
      // Dopo un errore di connessione si riprova solo se il cursore si è spostato (non a ogni
      // aggiornamento dell'editor, per esempio quando il pannello cambia altezza).
      const retry = last?.failed === true && last.head !== found.head;
      if (last && last.file === found.tab.path && last.template === found.src.template && !retry) {
        // Stesso template (magari spostato da righe aggiunte sopra): si spostano solo le righe.
        const shown = this.app.template;
        const shift = shown ? found.src.line - shown.line : 0;
        // Con una richiesta in corso il pannello mostra ancora il template di prima: niente spostamenti.
        if (shown && !shown.updating && shown.file === found.tab.path && shift !== 0) {
          const v = shown.view;
          const view = v.status === 'syntax' && v.line !== null ? { ...v, line: v.line + shift } : v;
          this.app.template = { ...shown, view, line: found.src.line };
        }
        return;
      }
    } else {
      const tab = this.app.focusedTab();
      if (!tab) return void this.app.toasts.show(t('template.noFile'), 'warning');
      if (isSecretsFile(tab.path)) return void this.app.toasts.show(t('template.secrets'), 'warning');
      found = this.templateIn(tab);
      if (!found) return void this.app.toasts.show(t('template.none'), 'warning');
    }
    const { tab, src } = found;
    clearTimeout(this.templateTimer);
    this.templateEdited = false;
    this.templateSent = { file: tab.path, template: src.template, head: found.head, failed: false };
    const run = ++this.templateRun;
    // File e riga in alto cambiano insieme al risultato: fino ad allora restano quelli mostrati.
    this.app.template =
      live && this.app.template
        ? { ...this.app.template, updating: true }
        : { view: { status: 'loading' }, file: tab.path, line: src.line, updating: false };
    let view: TemplateView;
    if (!haData.available) view = { status: 'failed', message: t('template.noHa') };
    else {
      try {
        const res = await api.ha.template(src.template, tab.path);
        // Le entità citate che HA non ha (solo se l'elenco delle entità è già arrivato).
        const known = haData.loaded && haData.entities.length > 0 ? new Set(haData.entities.map((e) => e.entity_id)) : null;
        const missing = known ? entitiesIn(src.template).filter((id) => !known.has(id)) : [];
        if (res.ok) view = { status: 'ok', result: res.result, missing };
        else if (res.kind === 'render') view = { status: 'render', message: res.message, missing };
        else {
          // HA non dice in che riga: la cerca EDITHA, se le righe del template sono quelle del file.
          const at = src.linear ? syntaxErrorLine(src.template) : null;
          view = { status: 'syntax', message: res.message, line: at === null ? null : src.line + at - 1 };
        }
      } catch (err) {
        view = { status: 'failed', message: this.app.errorText(err) };
      }
    }
    if (run === this.templateRun && this.app.template) {
      this.app.template = { ...this.app.template, view, file: tab.path, line: src.line, updating: false };
      // Non riuscita (HA non raggiungibile, in riavvio…): al prossimo spostamento del cursore si riprova.
      if (view.status === 'failed' && this.templateSent) this.templateSent = { ...this.templateSent, failed: true };
    }
  }

  /**
   * Con l'anteprima aperta, dopo una modifica (`edited`: la tab modificata) o uno spostamento del
   * cursore la ricalcola con una breve pausa.
   */
  scheduleTemplate(edited: EditorTab | null): void {
    if (!this.app.template) return;
    if (edited?.path === this.app.template.file) this.templateEdited = true;
    clearTimeout(this.templateTimer);
    this.templateTimer = setTimeout(() => void this.previewTemplate(true), 600);
  }


  closeTemplate(): void {
    clearTimeout(this.templateTimer);
    this.templateEdited = false;
    this.templateSent = null;
    this.templateRun++;
    this.app.template = null;
  }

  /** Porta alla riga dell'errore, nel file del template. */
  async templateGoTo(line: number): Promise<void> {
    const file = this.app.template?.file;
    if (!file) return;
    if (this.app.focusedTab()?.path !== file) await this.app.openFile(file);
    if (this.app.focusedTab()?.path === file) this.app.editor.goToLine(line, 'start');
  }

  private async withHa<T>(label: string, task: () => Promise<T>): Promise<T | null> {
    this.app.haBusy = true;
    this.app.refreshToolbar();
    this.app.toasts.show(label, 'info');
    try {
      return await task();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'config_invalid') {
        await this.app.dialog.inform({
          title: t('ha.invalidTitle'),
          message: t('ha.invalidAborted'),
          detail: String(err.details.errors ?? err.message),
        });
      } else {
        this.app.toasts.show(this.app.errorText(err), 'error');
      }
      return null;
    } finally {
      this.app.haBusy = false;
      this.app.refreshToolbar();
    }
  }

  /** Ricarica e riavvio leggono i file su disco: prima si decide cosa fare delle modifiche non salvate. */
  async ensureSaved(): Promise<boolean> {
    const dirty = this.app.tabs.tabs.filter((t) => t.dirty && !t.readOnly);
    if (dirty.length === 0) return true;
    const choice = await this.app.dialog.choose({
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
      await this.app.saveAll();
      return !this.app.tabs.tabs.some((t) => t.dirty && !t.readOnly);
    }
    return true;
  }

  private async haCheck(): Promise<void> {
    if (!(await this.ensureSaved())) return;
    const res = await this.withHa(t('ha.checking'), () => api.ha.check());
    if (!res) return;
    if (res.valid) {
      if (res.warnings) {
        await this.app.dialog.inform({ title: t('ha.validWithWarnings'), detail: res.warnings });
      } else {
        this.app.toasts.show(t('ha.valid'), 'success');
      }
    } else {
      await this.app.dialog.inform({
        title: t('ha.invalidTitle'),
        message: t('ha.invalidFix'),
        detail: res.errors ?? t('ha.unknownError'),
      });
    }
  }

  private async haReload(): Promise<void> {
    if (!(await this.ensureSaved())) return;
    const res = await this.withHa(t('ha.reloading'), () => api.ha.reload());
    if (res) this.app.toasts.show(t('ha.reloaded'), 'success');
  }

  private async haRestart(): Promise<void> {
    const ok = await this.app.dialog.confirm({
      title: t('ha.restartTitle'),
      message: t('ha.restartMessage'),
      confirmLabel: t('ha.restartConfirm'),
      danger: true,
    });
    if (!ok || !(await this.ensureSaved())) return;
    const res = await this.withHa(t('ha.restarting'), () => api.ha.restart());
    if (res) this.app.toasts.show(t('ha.restarted'), 'success');
  }
}
