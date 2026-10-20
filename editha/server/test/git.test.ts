import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { access, chmod, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { isSecretsFile } from '../src/fs/search.js';
import { DEFAULT_GITIGNORE } from '../src/git/git.js';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { makeSandbox, testConfig, type Sandbox } from './helpers.js';

const INGRESS = '172.30.32.2';

describe('Git locale (GIT-1)', () => {
  let sb: Sandbox;
  let app: FastifyInstance;

  beforeEach(async () => {
    sb = await makeSandbox();
    app = await buildApp(testConfig(sb), { logger: false });
  });

  afterEach(async () => {
    await app.close();
    await sb.cleanup();
  });

  const call = (method: 'GET' | 'POST', url: string) => app.inject({ method, url, remoteAddress: INGRESS });

  it('senza repository: lo dice; dopo l\'inizializzazione è pronto, sul ramo main, con il .gitignore di base', async () => {
    const before = (await call('GET', '/api/git/info')).json();
    assert.equal(before.available, true);
    assert.equal(before.repo, 'none');
    assert.equal(before.gitignore, false);

    const init = await call('POST', '/api/git/init');
    assert.equal(init.statusCode, 200);
    assert.equal(init.json().gitignoreCreated, true);
    assert.deepEqual(
      { repo: init.json().info.repo, branch: init.json().info.branch, head: init.json().info.head, gitignore: init.json().info.gitignore },
      { repo: 'ready', branch: 'main', head: null, gitignore: true },
    );
    const ignore = await readFile(path.join(sb.configDir, '.gitignore'), 'utf8');
    for (const line of ['.storage/', '.cloud/', '*.db', '*.log']) assert.ok(ignore.split('\n').includes(line), line);

    // Il .gitignore funziona davvero: secrets.yaml e .storage restano fuori.
    await writeFile(path.join(sb.configDir, 'secrets.yaml'), 'pw: x\n');
    await mkdir(path.join(sb.configDir, '.storage'));
    await writeFile(path.join(sb.configDir, '.storage/core.config'), '{}');
    await writeFile(path.join(sb.configDir, 'configuration.yaml'), 'a: 1\n');
    const status = execFileSync('git', ['-C', sb.configDir, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' });
    assert.deepEqual(status.trim().split('\n').sort(), ['?? .gitignore', '?? configuration.yaml']);

    const again = await call('POST', '/api/git/init');
    assert.equal(again.statusCode, 409);
  });

  it('non sovrascrive un .gitignore esistente', async () => {
    await writeFile(path.join(sb.configDir, '.gitignore'), 'mio\n');
    const init = (await call('POST', '/api/git/init')).json();
    assert.equal(init.gitignoreCreated, false);
    assert.equal(await readFile(path.join(sb.configDir, '.gitignore'), 'utf8'), 'mio\n');
    const add = (await call('POST', '/api/git/gitignore')).json();
    assert.equal(add.created, false);
  });

  it('un repository esistente si usa così com\'è; uno nella cartella sopra /config non conta', async () => {
    execFileSync('git', ['init', '--quiet', sb.base]);
    assert.equal((await call('GET', '/api/git/info')).json().repo, 'none');

    execFileSync('git', ['init', '--quiet', '--initial-branch=prova', sb.configDir]);
    await writeFile(path.join(sb.configDir, 'a.yaml'), 'a: 1\n');
    execFileSync('git', ['-C', sb.configDir, 'add', 'a.yaml']);
    execFileSync('git', ['-C', sb.configDir, '-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'Primo']);
    const info = (await call('GET', '/api/git/info')).json();
    assert.equal(info.repo, 'ready');
    assert.equal(info.branch, 'prova');
    assert.equal(info.head.subject, 'Primo');
    assert.match(info.head.hash, /^[0-9a-f]{40}$/);
  });

  it('il .gitignore di base tiene fuori tutte le copie di secrets.yaml, non i file normali', async () => {
    const secrets = ['secrets.yaml', 'Secrets.YAML', 'secrets.yml', 'secret.yaml', 'secrets_copy.yaml.bak', 'secrets.yaml_copy.bak',
      'secrets.yaml.old', 'secrets.yaml~', 'secrets_old.yaml', 'secrets2.yaml', '.secrets.yaml', '.secrets.yaml.swp', '#secrets.yaml#',
      'secret_old.yaml', 'secret.yaml.bak', 'secrets_esphome.yaml', 'secrets copy.yaml', 'secrets (1).yaml', 'secrets-old.yaml',
      'secret (1).yaml', 'secret2.yaml', 'secret.bak.yaml', 'esphome/secrets.yaml', '.secret.yaml', '#Secret.bak.yaml',
      '~secret_old.yml', '.secret (1).yaml'];
    const normal = ['secret_sensors.yaml', 'secret-door.yaml', 'secret_garage_automation.yml', 'secretary.yaml', 'my_secrets.yaml',
      'secrets.json', 'configuration.yaml'];
    for (const n of secrets) assert.equal(isSecretsFile(path.basename(n)), true, n);
    for (const n of normal) assert.equal(isSecretsFile(n), false, n);
    execFileSync('git', ['init', '--quiet', sb.configDir]);
    await writeFile(path.join(sb.configDir, '.gitignore'), DEFAULT_GITIGNORE);
    const check = (name: string) => {
      try {
        execFileSync('git', ['-C', sb.configDir, 'check-ignore', '--no-index', '-q', name]);
        return true;
      } catch {
        return false;
      }
    };
    for (const n of secrets) assert.equal(check(n), true, `ignorato: ${n}`);
    for (const n of normal) assert.equal(check(n), false, `non ignorato: ${n}`);
  });

  it('le impostazioni di .git/config non fanno partire programmi (firma finta con gpg.program)', async () => {
    execFileSync('git', ['init', '--quiet', '--initial-branch=main', sb.configDir]);
    await writeFile(path.join(sb.configDir, 'a.yaml'), 'a: 1\n');
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', sb.configDir, '-c', 'user.name=T', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim();
    git('add', 'a.yaml');
    const tree = git('write-tree');
    // Commit con una firma finta: con log.showSignature git chiamerebbe gpg.program.
    const body = `tree ${tree}\nauthor T <t@t> 0 +0000\ncommitter T <t@t> 0 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n -----END PGP SIGNATURE-----\n\nFirmato\n`;
    await writeFile(path.join(sb.base, 'commit.txt'), body);
    const hash = git('hash-object', '-t', 'commit', '-w', path.join(sb.base, 'commit.txt'));
    git('update-ref', 'refs/heads/main', hash);
    const marker = path.join(sb.base, 'eseguito');
    const script = path.join(sb.base, 'finto-gpg.sh');
    await writeFile(script, `#!/bin/sh\ntouch ${marker}\n`);
    await chmod(script, 0o755);
    git('config', 'log.showSignature', 'true');
    git('config', 'gpg.program', script);
    git('config', 'core.fsmonitor', script);
    git('config', 'core.pager', script);

    const info = (await call('GET', '/api/git/info')).json();
    assert.equal(info.repo, 'ready');
    assert.equal(info.head.subject, 'Firmato');
    await assert.rejects(access(marker));
  });

  it('una cartella .git che git non riconosce è segnalata come rovinata', async () => {
    await mkdir(path.join(sb.configDir, '.git'));
    assert.equal((await call('GET', '/api/git/info')).json().repo, 'broken');
    assert.equal((await call('POST', '/api/git/init')).statusCode, 409);
  });

  it('un .git che porta fuori da /config (link o file "gitdir:") non è accettato', async () => {
    execFileSync('git', ['init', '--quiet', path.join(sb.outsideDir, 'repo')]);
    await symlink(path.join(sb.outsideDir, 'repo', '.git'), path.join(sb.configDir, '.git'));
    assert.equal((await call('GET', '/api/git/info')).json().repo, 'broken');
    await import('node:fs/promises').then((fs) => fs.rm(path.join(sb.configDir, '.git')));
    await writeFile(path.join(sb.configDir, '.git'), `gitdir: ${path.join(sb.outsideDir, 'repo', '.git')}\n`);
    assert.equal((await call('GET', '/api/git/info')).json().repo, 'broken');
    assert.equal((await call('POST', '/api/git/init')).statusCode, 409);
  });
});
