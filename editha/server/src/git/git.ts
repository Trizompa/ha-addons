import { execFile } from 'node:child_process';
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EdithaError } from '../errors.js';
import { KeyedLock } from '../fs/lock.js';

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
].flatMap((setting) => ['-c', setting]);

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
  ) {}

  private async run(args: string[]): Promise<string> {
    await mkdir(this.home, { recursive: true });
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        ['-c', `safe.directory=${this.root}`, ...HARDENING, '-C', this.root, ...args],
        {
          timeout: TIMEOUT_MS,
          maxBuffer: 16 * 1024 * 1024,
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
          },
        },
        (err, stdout, stderr) => {
          if (!err) return resolve(stdout);
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return reject(new EdithaError('git_unavailable', 'Il programma git non è installato'));
          }
          const message = (stderr || err.message).trim().split('\n').slice(-3).join('\n').slice(0, 500);
          reject(new EdithaError('git_error', message || 'git ha risposto con un errore', { args: args[0] }));
        },
      );
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
