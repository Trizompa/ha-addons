import { execFile } from 'node:child_process';
import { appendFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EdithaError } from '../errors.js';
import { KeyedLock } from '../fs/lock.js';
import { isSecretsFile } from '../fs/search.js';

/** GIT-1: .gitignore di base, scritto solo se non ce n'è già uno. */
export const DEFAULT_GITIGNORE = `# Creato da EDITHA: file e cartelle che non entrano nel repository Git.
# Puoi modificarlo: ogni riga è un nome o un modello (* = qualunque testo).

# Password e chiavi: secrets.yaml e le sue copie (secrets.yaml.bak, secrets_old.yaml,
# .secrets.yaml.swp, secret.yaml, secret_old.yaml…), maiuscole comprese
[Ss][Ee][Cc][Rr][Ee][Tt][Ss].[Yy]*[Mm][Ll]*
[Ss][Ee][Cc][Rr][Ee][Tt][Ss][!a-zA-Z]*.[Yy]*[Mm][Ll]*
[.#~][Ss][Ee][Cc][Rr][Ee][Tt][Ss].[Yy]*[Mm][Ll]*
[.#~][Ss][Ee][Cc][Rr][Ee][Tt][Ss][!a-zA-Z]*.[Yy]*[Mm][Ll]*
[Ss][Ee][Cc][Rr][Ee][Tt].[Yy]*[Mm][Ll]*
[Ss][Ee][Cc][Rr][Ee][Tt][0-9]*.[Yy]*[Mm][Ll]*
[Ss][Ee][Cc][Rr][Ee][Tt][._~ -][0-9]*.[Yy]*[Mm][Ll]*
[Ss][Ee][Cc][Rr][Ee][Tt][._~ -][Bb][Aa][Kk]*.[Yy]*[Mm][Ll]*
[Ss][Ee][Cc][Rr][Ee][Tt][._~ -][Bb][Aa][Cc][Kk][Uu][Pp]*.[Yy]*[Mm][Ll]*
[Ss][Ee][Cc][Rr][Ee][Tt][._~ -][Oo][Ll][Dd]*.[Yy]*[Mm][Ll]*
[Ss][Ee][Cc][Rr][Ee][Tt][._~ -][Oo][Rr][Ii][Gg]*.[Yy]*[Mm][Ll]*
[Ss][Ee][Cc][Rr][Ee][Tt][._~ -][Cc][Oo][Pp][Yy]*.[Yy]*[Mm][Ll]*
[Ss][Ee][Cc][Rr][Ee][Tt][._~ -][Cc][Oo][Pp][Ii][Aa]*.[Yy]*[Mm][Ll]*
[Ss][Ee][Cc][Rr][Ee][Tt][._~ -][Nn][Ee][Ww]*.[Yy]*[Mm][Ll]*
[Ss][Ee][Cc][Rr][Ee][Tt]*([0-9]*).[Yy]*[Mm][Ll]*
[.#~][Ss][Ee][Cc][Rr][Ee][Tt].[Yy]*[Mm][Ll]*
[.#~][Ss][Ee][Cc][Rr][Ee][Tt][0-9]*.[Yy]*[Mm][Ll]*
[.#~][Ss][Ee][Cc][Rr][Ee][Tt][._~ -][0-9]*.[Yy]*[Mm][Ll]*
[.#~][Ss][Ee][Cc][Rr][Ee][Tt][._~ -][Bb][Aa][Kk]*.[Yy]*[Mm][Ll]*
[.#~][Ss][Ee][Cc][Rr][Ee][Tt][._~ -][Bb][Aa][Cc][Kk][Uu][Pp]*.[Yy]*[Mm][Ll]*
[.#~][Ss][Ee][Cc][Rr][Ee][Tt][._~ -][Oo][Ll][Dd]*.[Yy]*[Mm][Ll]*
[.#~][Ss][Ee][Cc][Rr][Ee][Tt][._~ -][Oo][Rr][Ii][Gg]*.[Yy]*[Mm][Ll]*
[.#~][Ss][Ee][Cc][Rr][Ee][Tt][._~ -][Cc][Oo][Pp][Yy]*.[Yy]*[Mm][Ll]*
[.#~][Ss][Ee][Cc][Rr][Ee][Tt][._~ -][Cc][Oo][Pp][Ii][Aa]*.[Yy]*[Mm][Ll]*
[.#~][Ss][Ee][Cc][Rr][Ee][Tt][._~ -][Nn][Ee][Ww]*.[Yy]*[Mm][Ll]*
[.#~][Ss][Ee][Cc][Rr][Ee][Tt]*([0-9]*).[Yy]*[Mm][Ll]*
*.token
.google.token
ip_bans.yaml
.uuid
zigbee2mqtt/

# Dati interni di Home Assistant
.storage/
.cloud/
.cache/
deps/
tts/
.HA_VERSION
.ha_run.lock

# Database e registri
*.db
*.db-shm
*.db-wal
*.sqlite
*.log
*.log.*

# File temporanei
__pycache__/
*.pyc
*.tmp
*.swp
*~
.DS_Store

# Componenti scaricati (HACS) e cartelle di lavoro di ESPHome
www/community/
esphome/.esphome/
`;

const TIMEOUT_MS = 30_000;

/**
 * Impostazioni che vincono su quelle del repository (.git/config può averlo scritto chiunque
 * abbia accesso a /config): niente programmi esterni, hook, firme, pager, rete. diff.external
 * non si può azzerare con -c: i comandi di confronto useranno --no-ext-diff e --no-textconv.
 */
const HARDENING = [
  'core.fsmonitor=false',
  'core.hooksPath=/dev/null',
  'core.sshCommand=false',
  'core.pager=cat',
  'core.askPass=false',
  'credential.helper=',
  'log.showSignature=false',
  'gpg.program=false',
  'gpg.openpgp.program=false',
  'gpg.x509.program=false',
  'gpg.ssh.program=false',
  'protocol.allow=never',
  // Un'impostazione per protocollo nel repository (protocol.ext.allow=always) vincerebbe su quella
  // generale: si spengono una per una (e GIT_ALLOW_PROTOCOL vuoto le blocca comunque tutte).
  ...['ext', 'file', 'ssh', 'git', 'http', 'https'].map((p) => `protocol.${p}.allow=never`),
  'commit.gpgSign=false',
  'tag.gpgSign=false',
  'gc.auto=0',
  'maintenance.auto=false',
].flatMap((setting) => ['-c', setting]);

/** GIT-2: un file cambiato rispetto all'ultimo commit. */
export interface GitChange {
  path: string;
  /** modified: modificato; added: nuovo (anche mai visto da git); deleted: eliminato; conflict: in conflitto. */
  status: 'modified' | 'added' | 'deleted' | 'conflict';
  /**
   * Perché non può entrare in un commit da EDITHA (null: può):
   * secret: secrets.yaml o una sua copia (SEC-7); sensitive: dati interni o credenziali di Home
   * Assistant (.storage, .cloud, token, database…); filter: il file passa da un filtro di git
   * (.gitattributes), che EDITHA non esegue, quindi finirebbe nel commit così com'è, segreti
   * compresi; conflict: in conflitto; nested: un altro repository dentro /config.
   */
  blocked: 'secret' | 'sensitive' | 'filter' | 'conflict' | 'nested' | null;
  /**
   * Cartella mai vista da git (una riga sola al posto di tutti i suoi file): quanti file entrerebbero
   * nel commit e quanti ne restano fuori comunque (segreti, dati interni, filtri).
   */
  folder?: { files: number; excluded: number };
  /** Mai visto da git (??): solo questi si possono escludere con il .gitignore. */
  untracked: boolean;
}

/** Riga dello stato con quello che serve al commit (non va al browser). */
type Change = GitChange & { xy: string; inner?: string[] };

/** Dati interni e credenziali di Home Assistant: mai in un commit, anche senza .gitignore. */
function isSensitive(p: string): boolean {
  const parts = p.replace(/\/$/, '').split('/');
  const name = parts[parts.length - 1]!;
  return (
    // Anche più in basso: le copie di backup di altri add-on contengono .storage interi.
    parts.some((part) => part === '.storage' || part === '.cloud') ||
    // Copie di secrets.yaml con un nome qualsiasi (20240101_secrets.yaml, old-secrets.yaml…).
    /secrets.*\.ya?ml/i.test(name) ||
    /\.token$/i.test(name) ||
    name === 'ip_bans.yaml' ||
    /\.(db|db-shm|db-wal|sqlite|sqlite3)$/i.test(name)
  );
}

/** GIT-5: un commit nell'elenco. */
export interface GitCommit {
  hash: string;
  author: string;
  date: string;
  subject: string;
}

const LOG_PAGE = 50;
/** Un commit indicato per codice (abbreviato o intero). */
const REV_RE = /^[0-9a-f]{4,64}$/;

/** Oltre questo numero di file lo stato si tronca (es. una cartella di immagini non ignorata). */
const MAX_CHANGES = 2000;

export interface GitInfo {
  /** Il programma git c'è. */
  available: boolean;
  version: string | null;
  /** none: nessun repository in /config; ready: pronto; broken: .git c'è ma git non lo legge. */
  repo: 'none' | 'ready' | 'broken';
  /** Ramo attuale (null se il HEAD è staccato). */
  branch: string | null;
  /** Ultimo commit; null se non ce n'è ancora uno. */
  head: { hash: string; subject: string; date: string } | null;
  gitignore: boolean;
}

/**
 * Git locale sulla cartella /config (GIT-1…6): solo comandi locali, mai rete. Ogni comando gira
 * senza shell, con gli argomenti in un elenco, senza configurazione di sistema o dell'utente
 * (HOME nella cartella dei dati) e senza cercare repository nelle cartelle sopra /config.
 */
export class GitService {
  private readonly lock = new KeyedLock();
  private version: string | null | undefined;

  constructor(
    private readonly root: string,
    private readonly home: string,
    private readonly maxFileSize = 2 * 1024 * 1024,
  ) {}

  /**
   * Comando che legge o scrive i file di /config (status, add, commit, diff): i filtri
   * (filter.<nome>.clean/smudge/process, attivati da .gitattributes) farebbero partire programmi
   * scritti in .git/config. Non si possono spegnere tutti insieme: si azzerano uno per uno.
   */
  private async runOnFiles(args: string[], input?: string): Promise<string> {
    const names = await this.run(['config', '--name-only', '--get-regexp', '^filter\\.']).catch(() => '');
    const overrides: string[] = [];
    for (const key of new Set(names.split('\n').filter(Boolean))) {
      const name = /^filter\.(.*)\.[^.]+$/s.exec(key)?.[1];
      if (name === undefined) continue;
      // Un nome con "=" non si può azzerare con -c: meglio non toccare niente.
      if (name.includes('=')) throw new EdithaError('git_error', 'Configurazione dei filtri di git non sicura in .git/config');
      for (const part of ['clean', 'smudge', 'process']) overrides.push('-c', `filter.${name}.${part}=`);
    }
    return this.run([...overrides, ...args], input);
  }

  private async run(args: string[], input?: string): Promise<string> {
    return (await this.runRaw(args, input)).toString('utf8');
  }

  /** Come run(), ma l'uscita resta in byte (contenuto dei file: si decodifica con cura). */
  private async runRaw(args: string[], input?: string): Promise<Buffer> {
    await mkdir(this.home, { recursive: true });
    return new Promise((resolve, reject) => {
      const child = execFile(
        'git',
        ['-c', `safe.directory=${this.root}`, ...HARDENING, '-C', this.root, ...args],
        {
          timeout: TIMEOUT_MS,
          encoding: 'buffer',
          maxBuffer: 64 * 1024 * 1024,
          env: {
            PATH: process.env.PATH ?? '/usr/bin:/bin',
            HOME: this.home,
            LC_ALL: 'C',
            GIT_TERMINAL_PROMPT: '0',
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CEILING_DIRECTORIES: path.dirname(this.root),
            // Il repository è sempre e solo /config/.git (non un file "gitdir:" che porta altrove).
            GIT_DIR: path.join(this.root, '.git'),
            GIT_WORK_TREE: this.root,
            // I percorsi passati sono nomi di file, mai modelli (*, :(glob)…).
            GIT_LITERAL_PATHSPECS: '1',
            // Mai rete: niente recupero automatico di oggetti mancanti (clone parziale) né protocolli.
            GIT_NO_LAZY_FETCH: '1',
            GIT_ALLOW_PROTOCOL: '',
          },
        },
        (err, stdout, stderrRaw) => {
          if (!err) return resolve(stdout);
          const stderr = stderrRaw.toString('utf8');
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return reject(new EdithaError('git_unavailable', 'Il programma git non è installato'));
          }
          // Troppi file o troppo tempo: di solito una cartella enorme non esclusa dal .gitignore.
          const code = (err as NodeJS.ErrnoException).code;
          if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || (err as { killed?: boolean }).killed) {
            return reject(
              new EdithaError('git_error', 'git ci mette troppo o elenca troppi file: aggiungi al .gitignore le cartelle da non conservare'),
            );
          }
          const message = (stderr || err.message).trim().split('\n').slice(-3).join('\n').slice(0, 500);
          reject(new EdithaError('git_error', message || 'git ha risposto con un errore', { args: args[0] }));
        },
      );
      // Elenchi di percorsi da stdin: niente limiti di lunghezza della riga di comando.
      child.stdin?.on('error', () => undefined);
      child.stdin?.end(input ?? '');
    });
  }

  /** Versione di git, o null se non è installato (letta una volta sola). */
  private async gitVersion(): Promise<string | null> {
    if (this.version === undefined) {
      try {
        this.version = (await this.run(['--version'])).trim().replace(/^git version\s*/, '');
      } catch {
        this.version = null;
      }
    }
    return this.version;
  }

  private async exists(rel: string): Promise<boolean> {
    return lstat(path.join(this.root, rel)).then(
      () => true,
      () => false,
    );
  }

  /** /config/.git è una cartella vera (non un link, non un file "gitdir:"). */
  private async gitDirIsReal(): Promise<boolean> {
    return lstat(path.join(this.root, '.git')).then(
      (st) => st.isDirectory(),
      () => false,
    );
  }

  async info(): Promise<GitInfo> {
    const version = await this.gitVersion();
    const gitignore = await this.exists('.gitignore');
    const base: GitInfo = { available: version !== null, version, repo: 'none', branch: null, head: null, gitignore };
    if (version === null || !(await this.exists('.git'))) return base;
    return this.lock.run('git', async () => {
      if (!(await this.gitDirIsReal())) return { ...base, repo: 'broken' };
      try {
        // Il repository deve essere proprio /config, non una cartella sopra.
        const top = (await this.run(['rev-parse', '--show-toplevel'])).trim();
        if ((await realpath(top)) !== (await realpath(this.root))) return { ...base, repo: 'broken' };
      } catch {
        return { ...base, repo: 'broken' };
      }
      const branch = (await this.run(['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => '')).trim() || null;
      let head: GitInfo['head'] = null;
      try {
        const [hash, subject, date] = (await this.run(['log', '-1', '--no-show-signature', '--format=%H%x00%s%x00%cI'])).trim().split('\0');
        if (hash) head = { hash, subject: subject ?? '', date: date ?? '' };
      } catch {
        // nessun commit ancora
      }
      return { ...base, repo: 'ready', branch, head };
    });
  }

  /** Il repository c'è ed è proprio /config/.git; altrimenti un errore chiaro. */
  private async requireRepo(): Promise<void> {
    if ((await this.gitVersion()) === null) throw new EdithaError('git_unavailable', 'Il programma git non è installato');
    if (!(await this.gitDirIsReal())) throw new EdithaError('not_found', 'In /config non c\'è un repository Git');
  }

  /** Perché un singolo file non può entrare in un commit (per nome; i filtri si guardano dopo). */
  private static blockedByName(p: string): 'secret' | 'sensitive' | null {
    return isSecretsFile(path.posix.basename(p.replace(/\/$/, ''))) ? 'secret' : isSensitive(p) ? 'sensitive' : null;
  }

  private async changes(): Promise<{ files: Change[]; truncated: boolean }> {
    // Le cartelle mai viste da git restano una riga sola (-unormal): al primo commit sono tante.
    const out = await this.runOnFiles(['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--no-renames', '--ignore-submodules=all']);
    const files: Change[] = [];
    let total = 0;
    for (const entry of out.split('\0')) {
      if (entry.length < 4) continue;
      const xy = entry.slice(0, 2);
      const p = entry.slice(3);
      total++;
      if (files.length >= MAX_CHANGES) continue;
      const status: GitChange['status'] =
        xy.includes('U') || xy === 'AA' || xy === 'DD'
          ? 'conflict'
          : xy.includes('D')
            ? 'deleted'
            : xy === '??' || xy.includes('A')
              ? 'added'
              : 'modified';
      const blocked: GitChange['blocked'] = status === 'conflict' ? 'conflict' : GitService.blockedByName(p);
      files.push({ path: p, status, blocked, xy, untracked: xy === '??' });
    }
    // Cartelle nuove: i file che contengono (rispettando il .gitignore), da contare e da controllare.
    const folders = files.filter((f) => f.path.endsWith('/') && f.blocked === null);
    if (folders.length > 0) {
      const untracked = (await this.run(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
      // Ogni file alla sua cartella, risalendo le cartelle sopra di lui (non tutti i file per ogni cartella).
      const byFolder = new Map<string, string[]>(folders.map((f) => [f.path, []]));
      for (const u of untracked) {
        let i = u.indexOf('/');
        while (i !== -1 && i < u.length - 1) {
          const list = byFolder.get(u.slice(0, i + 1));
          if (list) {
            list.push(u);
            break;
          }
          i = u.indexOf('/', i + 1);
        }
        if (byFolder.has(u)) byFolder.get(u)!.push(u);
      }
      for (const f of folders) {
        const inside = byFolder.get(f.path) ?? [];
        // Un altro repository: git lo vede come una cartella sola, senza file dentro.
        if (inside.length === 0 || inside.every((u) => u.endsWith('/')) || (await this.exists(path.posix.join(f.path, '.git')))) {
          f.blocked = 'nested';
          continue;
        }
        f.inner = inside.filter((u) => !u.endsWith('/'));
        f.folder = { files: 0, excluded: inside.length - f.inner.length };
      }
    }
    // File che passano da un filtro (.gitattributes): check-attr legge solo gli attributi.
    const candidates = new Set<string>();
    for (const f of files) {
      if (f.blocked !== null) continue;
      if (f.inner) f.inner.forEach((p) => candidates.add(p));
      else candidates.add(f.path);
    }
    const filtered = new Set<string>();
    if (candidates.size > 0) {
      const attrs = (await this.run(['check-attr', '--stdin', '-z', 'filter'], [...candidates].join('\0') + '\0')).split('\0');
      for (let i = 0; i + 2 < attrs.length; i += 3) {
        const value = attrs[i + 2]!;
        if (value !== 'unspecified' && value !== 'unset') filtered.add(attrs[i]!);
      }
    }
    for (const f of files) {
      if (f.blocked !== null) continue;
      if (f.inner && f.folder) {
        const ok = f.inner.filter((p) => !filtered.has(p) && GitService.blockedByName(p) === null);
        f.folder = { files: ok.length, excluded: f.folder.excluded + f.inner.length - ok.length };
        f.inner = ok;
        // Dentro c'è solo roba che non può entrare: la cartella intera resta fuori.
        if (ok.length === 0) f.blocked = 'sensitive';
      } else if (filtered.has(f.path)) f.blocked = 'filter';
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, truncated: total > files.length };
  }

  /** Unione, rebase, cherry-pick o revert lasciati a metà da un terminale. */
  private async operationInProgress(): Promise<boolean> {
    for (const name of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply']) {
      if (await this.exists(`.git/${name}`)) return true;
    }
    return false;
  }

  /** GIT-2: file modificati, nuovi ed eliminati rispetto all'ultimo commit (calcolato a richiesta). */
  async status(): Promise<{ files: GitChange[]; truncated: boolean; merging: boolean }> {
    await this.requireRepo();
    return this.lock.run('git', async () => {
      const { files, truncated } = await this.changes();
      return { files: files.map(({ xy: _xy, inner: _inner, ...f }) => f), truncated, merging: await this.operationInProgress() };
    });
  }

  /**
   * GIT-4: commit dei file indicati (o di tutti quelli cambiati) con un messaggio. secrets.yaml e
   * le sue copie non entrano mai: con "tutti" si saltano, se indicati per nome la richiesta è
   * rifiutata. Solo i file scelti: quello che era già pronto da un terminale resta com'è.
   */
  async commit(
    message: string,
    paths: string[] | 'all',
    /** File che l'utente ha visto in ogni cartella nuova scelta: se sono cambiati, si ricontrolla. */
    expected: Record<string, number> = {},
  ): Promise<{ hash: string; subject: string; files: number; skipped: string[] }> {
    if (message.includes('\0')) throw new EdithaError('invalid_request', 'Messaggio non valido');
    await this.requireRepo();
    return this.lock.run('git', async () => {
      if (await this.operationInProgress()) {
        throw new EdithaError('conflict', 'C\'è un\'operazione di git in corso (merge, rebase, cherry-pick…): completala o annullala da un terminale');
      }
      const { files: changed, truncated } = await this.changes();
      if (paths === 'all' && truncated) {
        throw new EdithaError(
          'invalid_request',
          `Più di ${MAX_CHANGES} file cambiati: aggiungi al .gitignore le cartelle da non conservare, oppure scegli i file`,
        );
      }
      const byPath = new Map(changed.map((c) => [c.path, c]));
      let chosen: Change[];
      if (paths === 'all') chosen = changed;
      else {
        chosen = [];
        for (const p of new Set(paths)) {
          const c = byPath.get(p);
          if (!c) throw new EdithaError('invalid_request', `Il file non ha modifiche da salvare in un commit: ${p}`);
          chosen.push(c);
        }
      }
      const blocked = chosen.filter((c) => c.blocked !== null).map((c) => c.path);
      if (paths !== 'all' && blocked.length > 0) {
        throw new EdithaError('forbidden_path', `Questi file non possono entrare in un commit da EDITHA: ${blocked.join(', ')}`);
      }
      const ok = chosen.filter((c) => c.blocked === null);
      for (const c of ok) {
        if (c.folder && expected[c.path] !== undefined && expected[c.path] !== c.folder.files) {
          throw new EdithaError('conflict', `Nel frattempo è cambiato il contenuto di ${c.path}: ricontrolla l'elenco e riprova`);
        }
      }
      // Una cartella nuova entra con i suoi file uno per uno: mai quelli esclusi che contiene.
      const list = ok.flatMap((c) => c.inner ?? [c.path]);
      if (list.length === 0) throw new EdithaError('invalid_request', 'Nessun file da salvare nel commit');
      // Chi è l'autore: quello configurato nel repository, altrimenti EDITHA.
      const name = (await this.run(['config', 'user.name']).catch(() => '')).trim();
      const email = (await this.run(['config', 'user.email']).catch(() => '')).trim();
      const identity = [
        ...(name ? [] : ['-c', 'user.name=EDITHA']),
        ...(email ? [] : ['-c', 'user.email=editha@homeassistant.local']),
      ];
      const nul = (items: string[]) => items.join('\0') + '\0';
      await this.runOnFiles(['add', '--all', '--pathspec-from-file=-', '--pathspec-file-nul'], nul(list));
      // Aggiunto da un terminale e poi eliminato (AD): dopo "add" non c'è più niente da salvare.
      const commitList = ok.filter((c) => c.xy !== 'AD').flatMap((c) => c.inner ?? [c.path]);
      if (commitList.length === 0) throw new EdithaError('invalid_request', 'Nessun file da salvare nel commit');
      await this.runOnFiles(
        [...identity, 'commit', '--quiet', '--no-verify', '--no-gpg-sign', '--cleanup=whitespace', '-m', message, '--only', '--pathspec-from-file=-', '--pathspec-file-nul'],
        nul(commitList),
      );
      const [hash, subject] = (await this.run(['log', '-1', '--no-show-signature', '--format=%H%x00%s'])).trim().split('\0');
      return { hash: hash ?? '', subject: subject ?? '', files: commitList.length, skipped: paths === 'all' ? blocked : [] };
    });
  }

  /**
   * GIT-3 e GIT-6: testo di un file com'era in un commit (HEAD: l'ultimo); null se lì non c'era, o
   * se non ci sono commit. Mai per secrets.yaml e copie o per i dati interni di Home Assistant (SEC-7).
   */
  async contentAt(rel: string, rev = 'HEAD'): Promise<{ path: string; content: string | null }> {
    if (rev !== 'HEAD' && !REV_RE.test(rev)) throw new EdithaError('invalid_request', `Commit non valido: ${rev}`);
    const p = rel;
    // Solo percorsi già normalizzati: con "./" o "." in mezzo git li risolverebbe, ma i controlli
    // sui segreti (cartella .storage…) guarderebbero il nome sbagliato.
    if (p === '' || p.includes('\0') || p.startsWith('/') || p.split('/').some((part) => part === '..' || part === '.' || part === '')) {
      throw new EdithaError('invalid_request', `Percorso non valido: ${rel}`);
    }
    if (isSecretsFile(path.posix.basename(p)) || isSensitive(p)) {
      throw new EdithaError('forbidden_path', 'Questo file non si mostra dal repository (segreti o dati interni)');
    }
    await this.requireRepo();
    return this.lock.run('git', async () => {
      if (rev !== 'HEAD' && !(await this.isCommit(rev))) throw new EdithaError('not_found', `Commit non trovato: ${rev}`);
      // ls-tree dice tipo e modo: solo file normali (100644/100755), non link né sottomoduli.
      let entry: string;
      try {
        entry = (await this.run(['ls-tree', '-z', '--full-tree', rev, '--', p])).split('\0')[0] ?? '';
      } catch {
        // Non c'è ancora nessun commit.
        return { path: p, content: null };
      }
      const m = /^(\d+) (\w+) ([0-9a-f]+)\t(.*)$/s.exec(entry);
      if (!m || m[4] !== p) return { path: p, content: null };
      // Una cartella non è un file da mostrare.
      if (m[2] === 'tree') return { path: p, content: null };
      if (m[2] !== 'blob' || (m[1] !== '100644' && m[1] !== '100755')) {
        throw new EdithaError('not_a_file', `Nel commit non è un file normale (collegamento o altro): ${p}`);
      }
      const size = Number((await this.run(['cat-file', '-s', m[3]!])).trim());
      if (size > this.maxFileSize) throw new EdithaError('too_large', p);
      // cat-file blob dà il contenuto così com'è, senza filtri né conversioni.
      const data = await this.runRaw(['cat-file', 'blob', m[3]!]);
      let content: string;
      try {
        content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data);
      } catch {
        throw new EdithaError('binary', p);
      }
      if (content.includes('\0')) throw new EdithaError('binary', p);
      return { path: p, content };
    });
  }

  private async isCommit(rev: string): Promise<boolean> {
    return this.run(['cat-file', '-t', rev]).then(
      (type) => type.trim() === 'commit',
      () => false,
    );
  }

  /** GIT-5: elenco dei commit, dal più recente (a pagine). */
  async log(skip = 0): Promise<{ commits: GitCommit[]; more: boolean }> {
    await this.requireRepo();
    return this.lock.run('git', async () => {
      let out: string;
      try {
        out = await this.run(['log', '--no-show-signature', '-z', '--format=%H%x1f%an%x1f%cI%x1f%s', `--skip=${skip}`, `-n${LOG_PAGE + 1}`]);
      } catch {
        // Nessun commit ancora.
        return { commits: [], more: false };
      }
      const commits = out
        .split('\0')
        .filter(Boolean)
        .map((line) => {
          const [hash, author, date, subject] = line.split('\x1f');
          return { hash: hash ?? '', author: author ?? '', date: date ?? '', subject: subject ?? '' };
        });
      return { commits: commits.slice(0, LOG_PAGE), more: commits.length > LOG_PAGE };
    });
  }

  /** GIT-5: file toccati da un commit (rispetto al primo genitore; tutti per il primo commit). */
  async commitFiles(rev: string): Promise<{ hash: string; files: { path: string; status: GitChange['status']; blocked: 'secret' | 'sensitive' | null }[] }> {
    if (!REV_RE.test(rev)) throw new EdithaError('invalid_request', `Commit non valido: ${rev}`);
    await this.requireRepo();
    return this.lock.run('git', async () => {
      if (!(await this.isCommit(rev))) throw new EdithaError('not_found', `Commit non trovato: ${rev}`);
      const hash = (await this.run(['rev-parse', '--verify', `${rev}^{commit}`])).trim();
      // diff-tree confronta solo gli oggetti già salvati: niente filtri né programmi esterni.
      const out = await this.run(['diff-tree', '-r', '-z', '--no-commit-id', '--name-status', '--no-renames', '--root', '-m', '--first-parent', hash]);
      const parts = out.split('\0').filter(Boolean);
      const files: { path: string; status: GitChange['status']; blocked: 'secret' | 'sensitive' | null }[] = [];
      for (let i = 0; i + 1 < parts.length; i += 2) {
        const code = parts[i]![0];
        const p = parts[i + 1]!;
        files.push({
          path: p,
          status: code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified',
          blocked: isSecretsFile(path.posix.basename(p)) ? 'secret' : isSensitive(p) ? 'sensitive' : null,
        });
      }
      return { hash, files };
    });
  }

  /**
   * Esclude un file o una cartella non ancora nel repository: aggiunge una riga al .gitignore
   * (creato se manca), ancorata a /config e con i caratteri speciali protetti.
   */
  async ignore(rel: string): Promise<void> {
    const dir = rel.endsWith('/');
    const p = dir ? rel.slice(0, -1) : rel;
    if (p === '' || /[\0\r\n]/.test(p) || p.startsWith('/') || p.split('/').some((part) => part === '..' || part === '.' || part === '')) {
      throw new EdithaError('invalid_request', `Percorso non valido: ${rel}`);
    }
    await this.requireRepo();
    await this.lock.run('git', async () => {
      // Nel .gitignore \ * ? [ ! # e gli spazi in fondo hanno un significato: si proteggono.
      const escaped = p.replace(/[\\*?[\]!#]/g, (c) => `\\${c}`).replace(/ $/, '\\ ');
      const line = `/${escaped}${dir ? '/' : ''}`;
      const file = path.join(this.root, '.gitignore');
      // Solo un file vero dentro /config (un link porterebbe a scrivere altrove).
      const st = await lstat(file).catch(() => null);
      if (st && !st.isFile()) throw new EdithaError('not_a_file', 'Il .gitignore non è un file normale');
      let current = '';
      try {
        current = await readFile(file, 'utf8');
      } catch {
        // non c'è ancora
      }
      if (current.split(/\r?\n/).includes(line)) return;
      const sep = current === '' || current.endsWith('\n') ? '' : '\n';
      await appendFile(file, `${sep}${line}\n`);
    });
  }

  /** Crea il .gitignore di base se non c'è; non sovrascrive mai quello esistente. */
  async writeGitignore(): Promise<boolean> {
    try {
      await writeFile(path.join(this.root, '.gitignore'), DEFAULT_GITIGNORE, { flag: 'wx' });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw err;
    }
  }

  /** GIT-1: nuovo repository in /config (ramo main) e .gitignore di base se manca. */
  async init(): Promise<{ info: GitInfo; gitignoreCreated: boolean }> {
    if ((await this.gitVersion()) === null) throw new EdithaError('git_unavailable', 'Il programma git non è installato');
    const gitignoreCreated = await this.lock.run('git', async () => {
      if (await this.exists('.git')) throw new EdithaError('already_exists', 'In /config esiste già un repository Git');
      await this.run(['init', '--quiet', '--initial-branch=main']);
      return this.writeGitignore();
    });
    return { info: await this.info(), gitignoreCreated };
  }
}
