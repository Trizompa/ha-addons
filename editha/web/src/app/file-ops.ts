import { api, ApiError, CLIENT_ID } from '../api/client.js';
import type { Entry } from '../api/types.js';
import { t } from '../i18n/index.js';
import { reconfigureEffects } from '../editor/setup.js';
import { basename, dirname, extension, join, validateName } from '../state/paths.js';
import { previewKind } from '../state/preview.js';
import { icons } from '../ui/icons.js';
import type { EdithaApp } from '../components/app.js';
import type { MenuEntry } from '../components/context-menu.js';
import type { EdithaFolderPicker } from '../components/folder-picker.js';

/** Operazioni sui file dell'albero: crea, rinomina, sposta, elimina, duplica, carica e scarica. */
export class FileOpsController {
  constructor(private readonly app: EdithaApp) {}

  /** Primo file scelto per un confronto (menu "Seleziona per il confronto"). */
  private compareBase: string | null = null;

  // ——— operazioni sui file (FS-2, FS-3, FS-4) ———

  /** Cartella di destinazione: quella selezionata, o la cartella del file selezionato (FEP #11). */
  private targetDir(entry?: Entry | null): string {
    if (entry) return entry.type === 'directory' ? entry.path : dirname(entry.path);
    const sel = this.app.tree.getSelection();
    if (!sel) return '';
    return sel.type === 'directory' ? sel.path : dirname(sel.path);
  }

  private async create(type: 'file' | 'directory', dir = this.targetDir()): Promise<void> {
    const where = dir === '' ? '/config' : `/config/${dir}`;
    const name = await this.app.dialog.prompt({
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
      this.app.toasts.show(t('create.failed', { name, error: this.app.errorText(err) }), 'error');
      return;
    }
    this.app.git.scheduleGitRefresh();
    await this.app.tree.refresh(dir);
    await this.app.tree.reveal(path, type);
    if (type === 'file') await this.app.openFile(path);
    this.app.flash(t('create.done', { name }));
  }

  private async rename(entry: { path: string; type: string }): Promise<void> {
    const old = basename(entry.path);
    const dot = entry.type === 'file' ? old.lastIndexOf('.') : -1;
    const name = await this.app.dialog.prompt({
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
      this.app.toasts.show(t('rename.failed', { name: old, error: this.app.errorText(err) }), 'error');
      return;
    }
    await this.afterMove(entry, to);
    this.app.flash(t('rename.done', { name }));
  }

  /** FS-5: "Sposta in…" con la scelta della cartella di destinazione (niente trascinamento). */
  private async moveEntry(entry: { path: string; type: string }): Promise<void> {
    let folders: string[];
    try {
      folders = (await api.folders()).folders;
    } catch (err) {
      this.app.toasts.show(t('move.failed', { name: basename(entry.path), error: this.app.errorText(err) }), 'error');
      return;
    }
    const name = basename(entry.path);
    const here = dirname(entry.path);
    const picker = this.app.renderRoot.querySelector('editha-folder-picker') as EdithaFolderPicker;
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
      this.app.toasts.show(t('move.failed', { name, error: this.app.errorText(err) }), 'error');
      return;
    }
    await this.afterMove(entry, to);
    this.app.git.scheduleGitRefresh();
    await this.app.tree.refresh(dest);
    await this.app.tree.reveal(to, entry.type as 'file' | 'directory');
    this.app.flash(t('move.done', { name, where: dest ? `/config/${dest}` : '/config' }));
  }

  /** Dopo rinomina o spostamento: tab, bozze, albero e sessione seguono il file. */
  private async afterMove(entry: { path: string; type: string }, to: string): Promise<void> {
    // Le tab aperte seguono il file (FEP #18); se cambia l'estensione cambia il linguaggio.
    const before = new Map(this.app.tabs.within(entry.path).map((tab) => [tab, tab.path]));
    for (const tab of this.app.tabs.rename(entry.path, to)) {
      this.app.applyEffects(tab, reconfigureEffects({ path: tab.path }));
      // La bozza segue il file.
      const old = before.get(tab);
      if (old && this.app.drafts.drafted.has(old)) {
        this.app.drafts.dropDraft(old, tab);
        if (tab.dirty) void this.app.drafts.writeDraft(tab);
      }
    }
    // Anche le bozze lasciate in sospeso seguono il file.
    for (const [path, deferred] of [...this.app.drafts.deferredDrafts]) {
      if (path !== entry.path && !path.startsWith(entry.path + '/')) continue;
      const moved = to + path.slice(entry.path.length);
      // Al nuovo nome c'è già un'altra bozza in sospeso: questa resta dov'è.
      if (this.app.drafts.deferredDrafts.has(moved)) continue;
      const draft = { ...deferred.draft, path: moved, client: CLIENT_ID };
      // Subito, prima di aspettare il server: una modifica fatta intanto vale già per il nuovo nome.
      this.app.drafts.deferredDrafts.delete(path);
      this.app.drafts.deferredDrafts.set(moved, { draft, asked: deferred.asked });
      try {
        await api.saveDraft(moved, draft.content, draft.etag);
      } catch {
        this.app.drafts.deferredDrafts.delete(moved);
        this.app.drafts.deferredDrafts.set(path, deferred);
        continue;
      }
      await api.deleteDraft(path, deferred.draft.client ?? null).catch(() => undefined);
    }
    // La cronologia aperta su quel percorso non è più valida.
    if (this.app.history && (this.app.history.path === entry.path || this.app.history.path.startsWith(entry.path + '/'))) {
      this.app.history = null;
    }
    // L'anteprima segue il file.
    if (this.app.preview && (this.app.preview === entry.path || this.app.preview.startsWith(entry.path + '/'))) {
      this.app.preview = to + this.app.preview.slice(entry.path.length);
    }
    this.app.tree.forget(entry.path);
    this.app.git.scheduleGitRefresh();
    await this.app.tree.refresh(dirname(entry.path));
    await this.app.tree.reveal(to, entry.type as 'file' | 'directory');
    this.app.refreshTabs();
    this.app.refreshStatus();
    this.app.scheduleSession();
  }

  private async deleteEntry(entry: { path: string; type: string }): Promise<void> {
    const name = basename(entry.path);
    const affected = this.app.tabs.within(entry.path);
    const dirty = affected.filter((t) => t.dirty);
    const what = entry.type === 'directory' ? t('delete.folderWhat', { name }) : name;
    const ok = await this.app.dialog.confirm({
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
          const sure = await this.app.dialog.confirm({
            title: entry.type === 'directory' ? t('delete.folderTitle') : t('delete.fileTitle'),
            message: t('delete.noBackupConfirm', { what }),
            confirmLabel: t('delete.noBackupConfirmLabel'),
            danger: true,
          });
          if (!sure) return;
          noBackup = true;
          continue;
        }
        this.app.toasts.show(t('delete.failed', { name, error: this.app.errorText(err) }), 'error');
        return;
      }
    }
    for (const tab of affected) await this.app.closeTab(tab.path, { force: true });
    // Eliminato su conferma: anche le bozze in sospeso di quei file non servono più.
    for (const [path, deferred] of [...this.app.drafts.deferredDrafts]) {
      if (path !== entry.path && !path.startsWith(entry.path + '/')) continue;
      this.app.drafts.deferredDrafts.delete(path);
      await api.deleteDraft(path, deferred.draft.client ?? null).catch(() => undefined);
    }
    if (this.app.history && (this.app.history.path === entry.path || this.app.history.path.startsWith(entry.path + '/'))) {
      this.app.history = null;
    }
    if (this.app.preview && (this.app.preview === entry.path || this.app.preview.startsWith(entry.path + '/'))) {
      this.app.closePreview();
    }
    this.app.tree.forget(entry.path);
    this.app.git.scheduleGitRefresh();
    await this.app.tree.refresh(dirname(entry.path));
    this.app.flash(t('delete.done', { name }));
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
    const name = await this.app.dialog.prompt({
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
      const ok = await this.app.dialog.confirm({
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
      this.app.toasts.show(t('duplicate.failed', { name: old, error: this.app.errorText(err) }), 'error');
      return;
    }
    this.app.git.scheduleGitRefresh();
    await this.app.tree.refresh(dir);
    await this.app.tree.reveal(to, 'file');
    await this.app.openFile(to);
    this.app.flash(t('duplicate.done', { name }));
  }


  // ——— upload e download dal PC (FS-6) ———

  uploadDir = '';

  private pickUpload(dir: string): void {
    const input = this.app.renderRoot.querySelector('#upload-input') as HTMLInputElement;
    this.uploadDir = dir;
    input.value = '';
    input.click();
  }

  async uploadFiles(dir: string, files: File[]): Promise<void> {
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
            const sure = await this.app.dialog.confirm({
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
            const choice = await this.app.dialog.choose({
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
              : t('upload.failed', { name: file.name, error: this.app.errorText(err) });
          this.app.toasts.show(message, 'error');
          break;
        }
      }
    }
    await this.afterUpload(dir, done);
  }

  private async afterUpload(dir: string, done: string[]): Promise<void> {
    if (done.length === 0) return;
    this.app.git.scheduleGitRefresh();
    await this.app.tree.refresh(dir);
    // Le tab aperte sui file sostituiti mostrano subito il nuovo contenuto, se non hanno modifiche.
    for (const name of done) {
      const tab = this.app.tabs.find(join(dir, name));
      if (tab && !tab.dirty) await this.app.reloadFromDisk(tab, true);
    }
    this.app.flash(done.length === 1 ? t('upload.doneOne', { name: done[0]! }) : t('upload.doneMany', { n: done.length }));
  }

  /**
   * Cartella come ZIP: secrets.yaml e le sue copie restano fuori, e lo si dice (SEC-7). Lo
   * scaricamento parte subito, nel clic (Safari blocca quelli avviati dopo un'attesa).
   */
  private async downloadFolder(path: string): Promise<void> {
    this.download(path);
    let excluded: string[] = [];
    try {
      excluded = (await api.zipExcluded(path)).excluded;
    } catch {
      // l'avviso non è indispensabile: lo ZIP li esclude comunque
    }
    if (excluded.length > 0) {
      this.app.toasts.show(
        excluded.length === 1
          ? t('download.secretsExcludedOne', { path: excluded[0]! })
          : t('download.secretsExcludedMany', { n: excluded.length }),
        'warning',
      );
    }
  }

  /** Il browser scarica il file (o lo ZIP della cartella) sul PC da cui si usa Editha. */
  download(path: string): void {
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
      this.app.flash(t('copy.done'));
    } catch {
      this.app.toasts.show(t('copy.failed'), 'warning');
    }
  }

  async onTreeContext(e: CustomEvent<{ entry: Entry | null; x: number; y: number }>): Promise<void> {
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
        ...(this.app.narrow || (entry.type === 'file' && previewKind(entry.path) && extension(entry.path) !== 'svg')
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
    const choice = await this.app.menu.show(items, x, y);
    switch (choice) {
      case 'new-file':
        return this.create('file', this.targetDir(entry));
      case 'new-folder':
        return this.create('directory', this.targetDir(entry));
      case 'refresh':
        return this.app.tree.refreshAll();
      case 'open':
        return entry ? this.app.openFile(entry.path) : undefined;
      case 'open-text':
        return entry ? this.app.openFile(entry.path, true) : undefined;
      case 'open-side':
        return entry ? this.app.openInSide(entry.path) : undefined;
      case 'rename':
        return entry ? this.rename(entry) : undefined;
      case 'copy-path':
        return entry ? this.copyPath(entry.path) : undefined;
      case 'upload':
        return this.pickUpload(this.targetDir(entry));
      case 'download':
        if (!entry) return undefined;
        return entry.type === 'directory' ? void this.downloadFolder(entry.path) : this.download(entry.path);
      case 'delete':
        return entry ? this.deleteEntry(entry) : undefined;
      case 'duplicate':
        return entry ? this.duplicate(entry) : undefined;
      case 'move':
        return entry ? this.moveEntry(entry) : undefined;
      case 'compare-select':
        if (entry) {
          this.compareBase = entry.path;
          this.app.toasts.show(t('compare.selected', { name: basename(entry.path) }), 'info');
        }
        return;
      case 'compare':
        return entry && this.compareBase ? this.app.openCompare(this.compareBase, entry.path) : undefined;
      case 'history':
        return entry ? this.app.openHistory(entry.path) : undefined;
    }
  }

  onTreeAction(e: CustomEvent<{ action: string }>): void {
    const sel = this.app.tree.getSelection();
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
        void this.app.openSearch();
        break;
      case 'git':
        void this.app.git.openGit();
        break;
      case 'toggle-system':
        void this.app.updateSettings({ showSystem: !this.app.settings.showSystem });
        break;
    }
  }
}
