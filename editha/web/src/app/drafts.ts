import { api, ApiError, CLIENT_ID, forgetKeptClientId, keepClientId, whileLeaving } from '../api/client.js';
import type { Draft, ListedDraft } from '../api/types.js';
import { t } from '../i18n/index.js';
import { docText } from '../editor/setup.js';
import { dirname, isSecretsFile } from '../state/paths.js';
import type { EdithaApp } from '../components/app.js';
import type { EditorTab } from '../components/editor-pane.js';
import { formatVersionDate } from '../components/history-panel.js';

/** Come LIVE_MS del server: dopo questo silenzio una finestra si considera chiusa. */
const DRAFT_LIVE_MS = 90_000;

/** Errori di apertura che non passano da soli: una bozza di quel file non si potrà mai salvare. */
export const PERMANENT_OPEN_ERRORS = new Set(['not_found', 'not_a_file', 'forbidden_path', 'binary', 'too_large']);

/** Bozze delle modifiche non salvate (ED-14), anche tra più finestre aperte. */
export class DraftsController {
  constructor(private readonly app: EdithaApp) {}

  // ——— bozze delle modifiche non salvate (ED-14) ———

  /** ED-14: bozze in attesa di scrittura e file che hanno una bozza sul server. */
  private readonly draftTimers = new Map<EditorTab, ReturnType<typeof setTimeout>>();
  readonly drafted = new Set<string>();
  /** Cresce a ogni salvataggio o scarto: una bozza in viaggio da prima è vecchia e va tolta. */
  private readonly draftGen = new WeakMap<EditorTab, number>();

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
  readonly deferredDrafts = new Map<string, { draft: Draft; asked: boolean }>();

  /** `byUser`: modifica scritta dall'utente (non una ricarica dal disco o un ripristino). */
  scheduleDraft(tab: EditorTab, delay = 1000, byUser = false): void {
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

  async writeDraft(tab: EditorTab): Promise<void> {
    clearTimeout(this.draftTimers.get(tab));
    this.draftTimers.delete(tab);
    this.draftDue.delete(tab);
    if (this.app.tabs.find(tab.path) !== tab) return;
    if (!tab.dirty) return this.dropDraft(tab.path, tab);
    const path = tab.path;
    // SEC-7: i valori di secrets.yaml non vanno nelle bozze (resterebbero in /data e passerebbero alle altre finestre).
    if (isSecretsFile(path)) return;
    if (this.deferredDrafts.has(path)) return;
    if (this.pendingDrafts.has(path)) return this.scheduleDraft(tab);
    const gen = this.draftGen.get(tab) ?? 0;
    try {
      await api.saveDraft(path, docText(this.app.pane.stateOf(tab)), tab.etag);
      // Salvata, scartata o rinominata nel frattempo: questa bozza non serve più.
      if ((this.draftGen.get(tab) ?? 0) !== gen || tab.path !== path) {
        api.deleteDraft(path).catch(() => undefined);
        // Rinominata: la bozza va riscritta sotto il nuovo nome.
        if (tab.path !== path && tab.dirty && this.app.tabs.find(tab.path) === tab) this.scheduleDraft(tab);
        return;
      }
      this.drafted.add(path);
    } catch (err) {
      // Editha non risponde (aggiornamento, riavvio): si riprova, e intanto il timer in attesa
      // fa sì che chiudendo la pagina la bozza parta comunque.
      if (err instanceof ApiError && err.code === 'offline' && tab.dirty && this.app.tabs.find(tab.path) === tab) {
        this.scheduleDraft(tab, 5000);
      }
    }
  }

  /** Si modifica un file con una bozza rimasta in sospeso: recuperarla o scartarla, adesso. */
  private async askDeferredDraft(tab: EditorTab, deferred: { draft: Draft; asked: boolean }): Promise<void> {
    deferred.asked = true;
    const { draft } = deferred;
    const choice = await this.app.dialog.choose({
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
      this.app.toasts.show(t('drafts.deferredKept', { name: tab.name }), 'warning');
      return;
    }
    if (choice === 'recover' && this.app.tabs.find(draft.path) !== tab) {
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
    this.app.replaceDoc(tab, mine.content);
    tab.etag = mine.etag;
    if (diskEtag !== mine.etag) this.app.toasts.show(t('drafts.changedOnDisk', { name: tab.name }), 'warning');
    const saved = this.app.saved.get(tab);
    tab.dirty = !saved || !this.app.pane.stateOf(tab).doc.eq(saved);
    this.drafted.add(tab.path);
    this.app.refreshTabs();
    if (this.app.tabs.active !== tab && this.app.side?.shown !== tab) this.app.activate(tab.path);
    this.app.flash(t('drafts.recovered'));
  }

  /** Scrive subito la bozza di ogni tab modificata (prima di ricaricare la pagina, al ritorno del server). */
  writeAllDrafts(): Promise<void[]> {
    return Promise.all(this.app.tabs.tabs.filter((t) => t.dirty && !t.readOnly).map((t) => this.writeDraft(t)));
  }

  dropDraft(path: string, tab?: EditorTab): void {
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
  flushDrafts(): void {
    for (const tab of [...this.draftTimers.keys()]) void this.writeDraft(tab);
  }

  readonly onVisibility = () => {
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
  async recoverDrafts(): Promise<void> {
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
        choice = await this.app.dialog.choose({
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
      await this.app.session.restoreSession();
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
      const key = DraftsController.draftKey(d);
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
    const others = list.filter((d) => d.live && d.client !== CLIENT_ID && !this.seenDrafts.has(DraftsController.draftKey(d)));
    if (others.length === 0) return;
    const wait = Math.min(...others.map((d) => DRAFT_LIVE_MS - (d.idleMs ?? 0))) + 3000;
    this.draftCheckTimer = setTimeout(() => void this.checkOrphanDrafts(), Math.min(Math.max(wait, 5000), 120_000));
  }

  /** Durante il lavoro: bozze lasciate da una finestra che nel frattempo si è chiusa. */
  private async checkOrphanDrafts(): Promise<void> {
    // Un'altra finestra di dialogo aperta verrebbe annullata: si riprova tra poco.
    // Una finestra nascosta non chiede niente: lo farà tornando in primo piano (onVisibility).
    if (document.hidden) return;
    if (this.app.dialog.busy) {
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
    if (this.app.dialog.busy || document.hidden) {
      clearTimeout(this.draftCheckTimer);
      this.draftCheckTimer = setTimeout(() => void this.checkOrphanDrafts(), 10_000);
      return;
    }
    // Un file con modifiche di questa finestra non riceve la bozza di un'altra a metà lavoro:
    // la si propone alla prossima apertura.
    const mine = (path: string) => this.drafted.has(path) || this.deferredDrafts.has(path) || !!this.app.tabs.find(path)?.dirty;
    const drafts = this.orphanDrafts(list).filter((d) => {
      if (!mine(d.path)) return true;
      this.seenDrafts.delete(DraftsController.draftKey(d));
      for (const old of this.supersededDrafts.get(d.path) ?? []) this.seenDrafts.delete(DraftsController.draftKey(old));
      this.supersededDrafts.delete(d.path);
      return false;
    });
    if (drafts.length) {
      const names = drafts.map((d) => `• ${d.path} (${formatVersionDate(d.savedAt)})`).join('\n');
      const choice = await this.app.dialog.choose({
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
          this.app.toasts.show(t('drafts.takenElsewhere', { name: draft.path }), 'info');
          return null;
        }
        claimed = res.draft;
      } catch {
        // Server non raggiungibile: la bozza resta dov'è, per la prossima volta.
        this.app.toasts.show(t('drafts.cannotOpen', { name: draft.path }), 'warning');
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

  /** All'avvio: si dice subito al server che questa finestra è aperta, e poi ogni 20 secondi. */
  startAlive(): void {
    this.sendAlive();
    this.aliveTimer = setInterval(this.sendAlive, 20_000);
  }

  /** Elemento staccato dalla pagina: si fermano i timer delle bozze. */
  stop(): void {
    clearInterval(this.aliveTimer);
    clearTimeout(this.draftCheckTimer);
  }

  /** Pagina ripresa dalla cache del browser (indietro/avanti): l'identità torna solo in memoria. */
  readonly onPageShow = () => forgetKeptClientId();

  readonly onPageHide = () => {
    keepClientId();
    whileLeaving(() => void api.draftsAlive(true).catch(() => undefined));
  };

  private async applyDrafts(drafts: Draft[]): Promise<void> {
    let first: EditorTab | null = null;
    for (const draft of drafts) {
      // Già in sospeso per quel file: vale la domanda alla prima modifica.
      if (this.deferredDrafts.has(draft.path) && this.deferredDrafts.get(draft.path)!.draft !== draft) continue;
      let failure: unknown = null;
      let tab = await this.app.loadTab(draft.path, undefined, true, (err) => (failure = err));
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
        this.app.toasts.show(t('drafts.dropped', { name: draft.path }), 'warning');
        continue;
      }
      if (!tab) {
        this.app.toasts.show(t('drafts.cannotOpen', { name: draft.path }), 'warning');
        continue;
      }
      if (tab.dirty) {
        // Modificato mentre si apriva la sessione: non si sovrascrive quello che si è appena scritto.
        this.app.toasts.show(t('drafts.skippedDirty', { name: tab.name }), 'warning');
        continue;
      }
      const diskEtag = tab.etag;
      if (docText(this.app.pane.stateOf(tab)) === draft.content) {
        // Uguale al file su disco: niente da recuperare.
        await this.discardDraft(draft);
        continue;
      }
      const mine = await this.claimDraft(draft);
      if (!mine) continue;
      this.app.replaceDoc(tab, mine.content);
      // L'etag di partenza: se il file è cambiato su disco, il salvataggio chiederà cosa fare (SEC-4).
      tab.etag = mine.etag;
      const saved = this.app.saved.get(tab);
      tab.dirty = !saved || !this.app.pane.stateOf(tab).doc.eq(saved);
      this.drafted.add(tab.path);
      if (diskEtag !== mine.etag) this.app.toasts.show(t('drafts.changedOnDisk', { name: tab.name }), 'warning');
      first ??= tab;
    }
    this.app.refreshTabs();
    if (first) {
      this.app.activate(first.path);
      this.app.flash(t('drafts.recovered'));
    }
  }

  /** Bozza di un file che non esiste più: ricrearlo con quelle modifiche, o scartarle. */
  private async recreateFromDraft(draft: Draft): Promise<EditorTab | null> {
    const choice = await this.app.dialog.choose({
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
      this.app.toasts.show(t('drafts.recreateFailed', { name: draft.path, error: this.app.errorText(err) }), 'error');
      return null;
    }
    await api.deleteDraft(draft.path).catch(() => undefined);
    this.app.git.scheduleGitRefresh();
    await this.app.tree.refresh(dirname(draft.path));
    const tab = await this.app.loadTab(draft.path, undefined, true);
    if (tab) {
      this.app.activate(tab.path);
      this.app.flash(t('drafts.recreated', { name: tab.name }));
    }
    return null;
  }
}
