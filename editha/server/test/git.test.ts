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
  const commit = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/git/commit', payload, remoteAddress: INGRESS });
  const gitOut = (...args: string[]) => execFileSync('git', ['-C', sb.configDir, ...args], { encoding: 'utf8' }).trim();

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
      '~secret_old.yml', '.secret (1).yaml', 'old_secrets.yaml', '20240101_secrets.yaml', 'secretsold.yaml'];
    const normal = ['secret_sensors.yaml', 'secret-door.yaml', 'secret_garage_automation.yml', 'secretary.yaml', 'secrets.json',
      'configuration.yaml'];
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

  it('GIT-2 e GIT-4: stato, commit dei file scelti e di tutti; secrets.yaml mai', async () => {
    await call('POST', '/api/git/init');
    await writeFile(path.join(sb.configDir, 'configuration.yaml'), 'a: 1\n');
    await writeFile(path.join(sb.configDir, 'automations.yaml'), '[]\n');
    // Una copia di secrets.yaml che il .gitignore (cambiato a mano) non esclude più.
    await writeFile(path.join(sb.configDir, '.gitignore'), '*.db\n');
    await writeFile(path.join(sb.configDir, 'secrets.yaml'), 'pw: x\n');

    const st = (await call('GET', '/api/git/status')).json();
    assert.deepEqual(
      st.files.map((f: { path: string; status: string; blocked: string | null }) => [f.path, f.status, f.blocked]),
      [
        ['.gitignore', 'added', null],
        ['automations.yaml', 'added', null],
        ['configuration.yaml', 'added', null],
        ['secrets.yaml', 'added', 'secret'],
      ],
    );
    assert.equal(st.merging, false);

    // Indicato per nome, secrets.yaml è rifiutato e non si committa niente.
    const refused = await commit({ message: 'Con segreti', paths: ['configuration.yaml', 'secrets.yaml'] });
    assert.equal(refused.statusCode, 403);
    assert.throws(() => gitOut('rev-parse', 'HEAD'));

    // Solo il file scelto.
    const one = await commit({ message: 'Primo commit', paths: ['configuration.yaml'] });
    assert.equal(one.statusCode, 200);
    assert.equal(one.json().files, 1);
    assert.equal(gitOut('log', '-1', '--format=%s %an'), 'Primo commit EDITHA');
    assert.equal(gitOut('show', '--name-only', '--format=', 'HEAD'), 'configuration.yaml');

    // Tutti: secrets.yaml saltato e segnalato.
    await writeFile(path.join(sb.configDir, 'configuration.yaml'), 'a: 2\n');
    const all = (await commit({ message: '#2 tutto il resto', all: true })).json();
    assert.equal(all.files, 3);
    assert.deepEqual(all.skipped, ['secrets.yaml']);
    assert.equal(gitOut('log', '-1', '--format=%s'), '#2 tutto il resto');
    assert.equal(gitOut('ls-files'), '.gitignore\nautomations.yaml\nconfiguration.yaml');

    // Eliminato.
    await import('node:fs/promises').then((fs) => fs.rm(path.join(sb.configDir, 'automations.yaml')));
    const st2 = (await call('GET', '/api/git/status')).json();
    assert.deepEqual(st2.files.map((f: { path: string; status: string }) => [f.path, f.status]), [
      ['automations.yaml', 'deleted'],
      ['secrets.yaml', 'added'],
    ]);
    assert.equal((await commit({ message: 'Via', paths: ['automations.yaml'] })).statusCode, 200);
    assert.equal(gitOut('ls-files'), '.gitignore\nconfiguration.yaml');

    // Richieste non valide: file senza modifiche, messaggio vuoto, niente da salvare.
    assert.equal((await commit({ message: 'x', paths: ['configuration.yaml'] })).statusCode, 400);
    assert.equal((await commit({ message: '   ', all: true })).statusCode, 400);
    assert.equal((await commit({ message: 'solo segreti', all: true })).statusCode, 400);
  });

  it('nomi di file con caratteri speciali e trattini restano nomi, non opzioni o modelli', async () => {
    await call('POST', '/api/git/init');
    await writeFile(path.join(sb.configDir, '-n.yaml'), 'a\n');
    await writeFile(path.join(sb.configDir, '*.yaml'), 'b\n');
    await writeFile(path.join(sb.configDir, 'altro.yaml'), 'c\n');
    const res = await commit({ message: 'Strani', paths: ['-n.yaml', '*.yaml'] });
    assert.equal(res.statusCode, 200);
    assert.equal(gitOut('ls-files'), '*.yaml\n-n.yaml');
  });

  it('i filtri di .gitattributes scritti in .git/config non partono con stato e commit', async () => {
    await call('POST', '/api/git/init');
    const marker = path.join(sb.base, 'eseguito');
    const script = path.join(sb.base, 'filtro.sh');
    await writeFile(script, `#!/bin/sh\ntouch ${marker}\ncat\n`);
    await chmod(script, 0o755);
    gitOut('config', 'filter.x.clean', script);
    gitOut('config', 'filter.x.process', script);
    // Il filtro vale per tutti i file tranne .gitattributes e b.yaml: anche così niente deve partire.
    await writeFile(path.join(sb.configDir, '.gitattributes'), '* filter=x\n.gitattributes -filter\nb.yaml -filter\n');
    await writeFile(path.join(sb.configDir, 'a.yaml'), 'a: 1\n');
    await writeFile(path.join(sb.configDir, 'b.yaml'), 'b: 1\n');
    assert.equal((await call('GET', '/api/git/status')).statusCode, 200);
    assert.equal((await commit({ message: 'Con filtro', all: true })).statusCode, 200);
    // Anche .gitignore passa dal filtro: resta fuori.
    assert.equal(gitOut('ls-files'), '.gitattributes\nb.yaml');
    await writeFile(path.join(sb.configDir, 'a.yaml'), 'a: 2\n');
    assert.equal((await call('GET', '/api/git/status')).statusCode, 200);
    await assert.rejects(access(marker));
  });

  it('senza repository stato e commit danno un errore chiaro', async () => {
    assert.equal((await call('GET', '/api/git/status')).statusCode, 404);
    assert.equal((await commit({ message: 'x', all: true })).statusCode, 404);
  });

  it('file con un filtro di git, dati interni di HA, repository annidati: mai in un commit', async () => {
    await call('POST', '/api/git/init');
    await writeFile(path.join(sb.configDir, '.gitignore'), '');
    // Un filtro che toglie il token: EDITHA non lo esegue, quindi il file non deve partire così com'è.
    gitOut('config', 'filter.redact.clean', "sed 's/token: .*/token: X/'");
    await writeFile(path.join(sb.configDir, '.gitattributes'), 'a.yaml filter=redact\n');
    await writeFile(path.join(sb.configDir, 'a.yaml'), 'token: SEGRETO\n');
    await mkdir(path.join(sb.configDir, '.storage'));
    await writeFile(path.join(sb.configDir, '.storage/auth'), '{}');
    await writeFile(path.join(sb.configDir, 'google.token'), 'x');
    await writeFile(path.join(sb.configDir, 'home-assistant_v2.db'), 'x');
    execFileSync('git', ['init', '--quiet', path.join(sb.configDir, 'annidato')]);
    await writeFile(path.join(sb.configDir, 'annidato/x.yaml'), 'x\n');
    await writeFile(path.join(sb.configDir, 'ok.yaml'), 'ok\n');

    const st = (await call('GET', '/api/git/status')).json();
    const blocked = Object.fromEntries(st.files.map((f: { path: string; blocked: string | null }) => [f.path, f.blocked]));
    assert.deepEqual(blocked, {
      '.gitattributes': null,
      '.gitignore': null,
      '.storage/': 'sensitive',
      'a.yaml': 'filter',
      'annidato/': 'nested',
      'google.token': 'sensitive',
      'home-assistant_v2.db': 'sensitive',
      'ok.yaml': null,
    });
    assert.equal((await commit({ message: 'x', paths: ['a.yaml'] })).statusCode, 403);
    const all = (await commit({ message: 'Tutto', all: true })).json();
    assert.equal(all.files, 3);
    assert.deepEqual(all.skipped.sort(), ['.storage/', 'a.yaml', 'annidato/', 'google.token', 'home-assistant_v2.db']);
    assert.equal(gitOut('ls-files'), '.gitattributes\n.gitignore\nok.yaml');
  });

  it('un file aggiunto da un terminale e poi eliminato non blocca il commit; durante un merge si rifiuta', async () => {
    await call('POST', '/api/git/init');
    await writeFile(path.join(sb.configDir, 'b.yaml'), 'b\n');
    await writeFile(path.join(sb.configDir, 'ad.yaml'), 'x\n');
    gitOut('add', 'ad.yaml');
    await import('node:fs/promises').then((fs) => fs.rm(path.join(sb.configDir, 'ad.yaml')));
    const st = (await call('GET', '/api/git/status')).json();
    assert.equal(st.files.find((f: { path: string }) => f.path === 'ad.yaml').status, 'deleted');
    const res = await commit({ message: 'Con AD', paths: ['ad.yaml', 'b.yaml'] });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().files, 1);
    assert.equal(gitOut('ls-files'), 'b.yaml');

    await writeFile(path.join(sb.configDir, '.git/MERGE_HEAD'), gitOut('rev-parse', 'HEAD') + '\n');
    await writeFile(path.join(sb.configDir, 'b.yaml'), 'b2\n');
    assert.equal((await call('GET', '/api/git/status')).json().merging, true);
    assert.equal((await commit({ message: 'Durante merge', all: true })).statusCode, 409);
  });

  it('un messaggio con un carattere nullo è rifiutato senza errori interni', async () => {
    await call('POST', '/api/git/init');
    await writeFile(path.join(sb.configDir, 'c.yaml'), 'c\n');
    assert.equal((await commit({ message: 'a\u0000b', all: true })).statusCode, 400);
  });

  it('GIT-3: il file com\'era nell\'ultimo commit, mai per i segreti', async () => {
    const head = (p: string) => app.inject({ method: 'GET', url: `/api/git/head?path=${encodeURIComponent(p)}`, remoteAddress: INGRESS });
    assert.equal((await head('a.yaml')).statusCode, 404);
    await call('POST', '/api/git/init');
    await writeFile(path.join(sb.configDir, 'a.yaml'), 'a: 1\n');
    assert.deepEqual((await head('a.yaml')).json(), { path: 'a.yaml', content: null });
    assert.equal((await commit({ message: 'Primo', paths: ['a.yaml'] })).statusCode, 200);
    await writeFile(path.join(sb.configDir, 'a.yaml'), 'a: 2\n');
    assert.deepEqual((await head('a.yaml')).json(), { path: 'a.yaml', content: 'a: 1\n' });
    assert.deepEqual((await head('nuovo.yaml')).json(), { path: 'nuovo.yaml', content: null });
    // Una cartella non è un file.
    await mkdir(path.join(sb.configDir, 'cartella'));
    await writeFile(path.join(sb.configDir, 'cartella/x.yaml'), 'x\n');
    assert.equal((await commit({ message: 'Cartella', paths: ['cartella/'] })).statusCode, 200);
    assert.deepEqual((await head('cartella')).json(), { path: 'cartella', content: null });
    for (const p of ['secrets.yaml', 'pacchetti/secrets_old.yaml', '.storage/auth']) assert.equal((await head(p)).statusCode, 403, p);
    for (const p of ['../fuori', '/etc/passwd', 'a//b']) assert.equal((await head(p)).statusCode, 400, p);
  });

  it('GIT-5: elenco dei commit a pagine e file toccati; GIT-6: il file com\'era in un commit', async () => {
    const get = (url: string) => app.inject({ method: 'GET', url, remoteAddress: INGRESS });
    assert.equal((await get('/api/git/log')).statusCode, 404);
    await call('POST', '/api/git/init');
    assert.deepEqual((await get('/api/git/log')).json(), { commits: [], more: false });
    await writeFile(path.join(sb.configDir, 'a.yaml'), 'a: 1\n');
    await commit({ message: 'Primo', paths: ['a.yaml'] });
    await writeFile(path.join(sb.configDir, 'a.yaml'), 'a: 2\n');
    await writeFile(path.join(sb.configDir, 'b.yaml'), 'b\n');
    await commit({ message: 'Secondo', all: true });
    await import('node:fs/promises').then((fs) => fs.rm(path.join(sb.configDir, 'b.yaml')));
    await commit({ message: 'Terzo', all: true });

    const log = (await get('/api/git/log')).json();
    assert.deepEqual(log.commits.map((c: { subject: string }) => c.subject), ['Terzo', 'Secondo', 'Primo']);
    assert.equal(log.more, false);
    assert.equal(log.commits[0].author, 'EDITHA');
    assert.deepEqual((await get('/api/git/log?skip=2')).json().commits.map((c: { subject: string }) => c.subject), ['Primo']);
    assert.equal((await get('/api/git/log?skip=-1')).statusCode, 400);

    const [terzo, secondo, primo] = log.commits.map((c: { hash: string }) => c.hash);
    const files = async (rev: string) => (await get(`/api/git/commit-files?rev=${rev}`)).json().files.map((f: { path: string; status: string }) => [f.path, f.status]);
    assert.deepEqual(await files(primo), [['a.yaml', 'added']]);
    assert.deepEqual(await files(secondo), [['.gitignore', 'added'], ['a.yaml', 'modified'], ['b.yaml', 'added']]);
    assert.deepEqual(await files(terzo.slice(0, 7)), [['b.yaml', 'deleted']]);
    assert.equal((await get('/api/git/commit-files?rev=HEAD')).statusCode, 400);
    assert.equal((await get('/api/git/commit-files?rev=0000000')).statusCode, 404);

    const show = async (p: string, rev: string) => (await get(`/api/git/show?path=${encodeURIComponent(p)}&rev=${rev}`)).json();
    assert.equal((await show('a.yaml', primo)).content, 'a: 1\n');
    assert.equal((await show('a.yaml', secondo)).content, 'a: 2\n');
    assert.equal((await show('b.yaml', secondo)).content, 'b\n');
    assert.equal((await show('b.yaml', terzo)).content, null);
    assert.equal((await get(`/api/git/show?path=secrets.yaml&rev=${primo}`)).statusCode, 403);
    assert.equal((await get('/api/git/show?path=a.yaml&rev=HEAD~1')).statusCode, 400);
  });

  it('percorsi con "./", link e testo non UTF-8: niente segreti né contenuti rovinati', async () => {
    const get = (url: string) => app.inject({ method: 'GET', url, remoteAddress: INGRESS });
    await call('POST', '/api/git/init');
    await writeFile(path.join(sb.configDir, '.gitignore'), '');
    await mkdir(path.join(sb.configDir, '.storage'));
    await writeFile(path.join(sb.configDir, '.storage/auth'), 'TOKEN\n');
    await writeFile(path.join(sb.configDir, 'latin1.txt'), Buffer.from([0x63, 0x69, 0x74, 0x74, 0xe0, 0x0a]));
    await symlink('configuration.yaml', path.join(sb.configDir, 'link.yaml'));
    await writeFile(path.join(sb.configDir, 'configuration.yaml'), 'a: 1\n');
    // .storage committato da un terminale.
    gitOut('add', '-A');
    gitOut('-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'Tutto');
    for (const p of ['././.storage/auth', './.storage/auth', '.storage/./auth', 'a/./b', './configuration.yaml']) {
      const res = await get(`/api/git/head?path=${encodeURIComponent(p)}`);
      assert.equal(res.statusCode, 400, p);
      assert.ok(!res.body.includes('TOKEN'), p);
    }
    assert.equal((await get('/api/git/head?path=.storage%2Fauth')).statusCode, 403);
    assert.equal((await get('/api/git/head?path=link.yaml')).statusCode, 400);
    assert.equal((await get('/api/git/head?path=latin1.txt')).statusCode, 415);
    assert.equal((await get('/api/git/head?path=configuration.yaml')).json().content, 'a: 1\n');
  });

  it('un .git/config che chiede di scaricare oggetti mancanti (clone parziale) non fa partire niente', async () => {
    const get = (url: string) => app.inject({ method: 'GET', url, remoteAddress: INGRESS });
    await call('POST', '/api/git/init');
    await writeFile(path.join(sb.configDir, 'a.yaml'), 'a: 1\n');
    await commit({ message: 'Primo', paths: ['a.yaml'] });
    // Il contenuto di a.yaml sparisce dagli oggetti e il repository dice di riprenderlo da "origin".
    const blob = gitOut('rev-parse', 'HEAD:a.yaml');
    await import('node:fs/promises').then((fs) => fs.rm(path.join(sb.configDir, '.git/objects', blob.slice(0, 2), blob.slice(2))));
    const marker = path.join(sb.base, 'eseguito');
    gitOut('config', 'remote.origin.url', `ext::sh -c touch% ${marker}`);
    gitOut('config', 'remote.origin.promisor', 'true');
    gitOut('config', 'extensions.partialClone', 'origin');
    gitOut('config', 'protocol.ext.allow', 'always');
    await get('/api/git/head?path=a.yaml');
    await get('/api/git/log');
    await get(`/api/git/commit-files?rev=${gitOut('rev-parse', 'HEAD')}`);
    await assert.rejects(access(marker));
  });

  it('cartelle nuove: una riga sola con il conteggio, commit dei file dentro tranne gli esclusi; Escludi', async () => {
    await call('POST', '/api/git/init');
    await mkdir(path.join(sb.configDir, 'custom_components/hacs/frontend'), { recursive: true });
    for (let i = 0; i < 30; i++) await writeFile(path.join(sb.configDir, `custom_components/hacs/frontend/f${i}.js`), `${i}\n`);
    await writeFile(path.join(sb.configDir, 'custom_components/hacs/secrets.yaml'), 'pw: x\n');
    await writeFile(path.join(sb.configDir, 'custom_components/hacs/cache.token'), 'x');
    await mkdir(path.join(sb.configDir, 'pacchetti'));
    await writeFile(path.join(sb.configDir, 'pacchetti/luci.yaml'), 'a\n');
    await writeFile(path.join(sb.configDir, 'pacchetti/[strano] #1.yaml'), 'b\n');
    await writeFile(path.join(sb.configDir, '.gitignore'), '*.db');

    const st = (await call('GET', '/api/git/status')).json();
    const rows = Object.fromEntries(
      st.files.map((f: { path: string; folder?: { files: number; excluded: number }; blocked: unknown }) => [
        f.path,
        [f.folder ? { files: f.folder.files, excluded: f.folder.excluded } : null, f.blocked],
      ]),
    );
    // secrets.yaml è escluso già dal .gitignore? No: il .gitignore qui è "*.db", quindi conta tra gli esclusi.
    assert.deepEqual(rows, {
      '.gitignore': [null, null],
      'custom_components/': [{ files: 30, excluded: 2 }, null],
      'pacchetti/': [{ files: 2, excluded: 0 }, null],
    });

    // Escludi: la riga va nel .gitignore, ancorata e con i caratteri speciali protetti.
    const ignore = (p: string) => app.inject({ method: 'POST', url: '/api/git/ignore', payload: { path: p }, remoteAddress: INGRESS });
    assert.equal((await ignore('custom_components/')).statusCode, 200);
    assert.equal((await ignore('pacchetti/[strano] #1.yaml')).statusCode, 200);
    assert.equal((await ignore('custom_components/')).statusCode, 200);
    const header = '# Excluded with EDITHA (crossed-out eye in the Git panel)';
    assert.equal(
      await readFile(path.join(sb.configDir, '.gitignore'), 'utf8'),
      `*.db\n\n${header}\n/custom_components/\n/pacchetti/\\[strano\\] \\#1.yaml\n`,
    );
    const listed = (await call('GET', '/api/git/ignored')).json().entries;
    assert.deepEqual(listed, [
      { line: '/custom_components/', path: 'custom_components/' },
      { line: '/pacchetti/\\[strano\\] \\#1.yaml', path: 'pacchetti/[strano] #1.yaml' },
    ]);
    // Includi di nuovo: la riga se ne va e la cartella ricompare.
    const unignore = (line: string) => app.inject({ method: 'POST', url: '/api/git/unignore', payload: { line }, remoteAddress: INGRESS });
    assert.equal((await unignore('/custom_components/')).statusCode, 200);
    assert.equal((await unignore('/custom_components/')).statusCode, 404);
    assert.equal((await unignore('*.db')).statusCode, 400);
    assert.ok((await call('GET', '/api/git/status')).json().files.some((f: { path: string }) => f.path === 'custom_components/'));
    assert.equal((await ignore('custom_components/')).statusCode, 200);
    for (const p of ['../x', '/etc', 'a\nb', './a']) assert.equal((await ignore(p)).statusCode, 400, p);
    const st2 = (await call('GET', '/api/git/status')).json();
    assert.deepEqual(st2.files.map((f: { path: string; folder?: { files: number } }) => [f.path, f.folder?.files ?? null]), [
      ['.gitignore', null],
      ['pacchetti/', 1],
    ]);

    // Commit della cartella: entrano i suoi file uno per uno.
    const res = (await commit({ message: 'Pacchetti', paths: ['pacchetti/', '.gitignore'] })).json();
    assert.equal(res.files, 2);
    assert.equal(gitOut('ls-files'), '.gitignore\npacchetti/luci.yaml');
  });

  it('una cartella nuova con dentro segreti: i segreti restano fuori dal commit', async () => {
    await call('POST', '/api/git/init');
    await writeFile(path.join(sb.configDir, '.gitignore'), '');
    await mkdir(path.join(sb.configDir, 'esphome'));
    await writeFile(path.join(sb.configDir, 'esphome/secrets.yaml'), 'wifi: x\n');
    await writeFile(path.join(sb.configDir, 'esphome/nodo.yaml'), 'esphome: {}\n');
    const st = (await call('GET', '/api/git/status')).json();
    assert.deepEqual(st.files.find((f: { path: string }) => f.path === 'esphome/').folder, { files: 1, excluded: 1, list: ['esphome/nodo.yaml'] });
    await commit({ message: 'ESPHome', paths: ['esphome/'] });
    assert.equal(gitOut('ls-files', 'esphome'), 'esphome/nodo.yaml');
  });

  it('cartelle nuove: .storage più in basso, copie di secrets con altri nomi, repository annidati più in basso', async () => {
    await call('POST', '/api/git/init');
    await writeFile(path.join(sb.configDir, '.gitignore'), '');
    await mkdir(path.join(sb.configDir, '.ha_mcp/backups/1/.storage'), { recursive: true });
    await writeFile(path.join(sb.configDir, '.ha_mcp/backups/1/.storage/core.config_entries'), 'TOKEN');
    await writeFile(path.join(sb.configDir, '.ha_mcp/backups/1/20240101_secrets.yaml'), 'pw: x\n');
    await writeFile(path.join(sb.configDir, '.ha_mcp/backups/1/automations.yaml'), '[]\n');
    await mkdir(path.join(sb.configDir, 'dentro/sotto'), { recursive: true });
    execFileSync('git', ['init', '--quiet', path.join(sb.configDir, 'dentro/sotto')]);
    await writeFile(path.join(sb.configDir, 'dentro/sotto/x.yaml'), 'x\n');

    const st = (await call('GET', '/api/git/status')).json();
    const row = (p: string) => st.files.find((f: { path: string }) => f.path === p);
    assert.deepEqual(row('.ha_mcp/').folder, { files: 1, excluded: 2, list: ['.ha_mcp/backups/1/automations.yaml'] });
    assert.equal(row('.ha_mcp/').untracked, true);
    assert.equal(row('dentro/').blocked, 'nested');

    // Il numero di file visto non torna più: il commit si ferma.
    await writeFile(path.join(sb.configDir, '.ha_mcp/backups/1/scripts.yaml'), '{}\n');
    const stale = await commit({ message: 'Vecchio', paths: ['.ha_mcp/'], folders: { '.ha_mcp/': 1 } });
    assert.equal(stale.statusCode, 409);
    const ok = await commit({ message: 'Backup', paths: ['.ha_mcp/'], folders: { '.ha_mcp/': 2 } });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(gitOut('ls-files'), '.ha_mcp/backups/1/automations.yaml\n.ha_mcp/backups/1/scripts.yaml');
  });

  it('cartelle nuove: i file uno per uno (elenco limitato, commit di alcuni, mai gli esclusi)', async () => {
    await call('POST', '/api/git/init');
    await writeFile(path.join(sb.configDir, '.gitignore'), '');
    await mkdir(path.join(sb.configDir, 'www/sotto'), { recursive: true });
    await writeFile(path.join(sb.configDir, 'www/b.js'), 'b\n');
    await writeFile(path.join(sb.configDir, 'www/a.js'), 'a\n');
    await writeFile(path.join(sb.configDir, 'www/sotto/c.js'), 'c\n');
    await writeFile(path.join(sb.configDir, 'www/secrets.yaml'), 'pw: x\n');
    await mkdir(path.join(sb.configDir, 'grande'));
    for (let i = 0; i < 250; i++) await writeFile(path.join(sb.configDir, `grande/f${String(i).padStart(3, '0')}.js`), `${i}\n`);

    const st = (await call('GET', '/api/git/status')).json();
    const row = (p: string) => st.files.find((f: { path: string }) => f.path === p);
    assert.deepEqual(row('www/').folder, { files: 3, excluded: 1, list: ['www/a.js', 'www/b.js', 'www/sotto/c.js'] });
    assert.equal(row('grande/').folder.files, 250);
    assert.equal(row('grande/').folder.list.length, 200);
    assert.equal(row('grande/').folder.list[0], 'grande/f000.js');

    // Un file dentro una cartella nuova non si può scegliere se è escluso, o se non esiste.
    assert.equal((await commit({ message: 'No', paths: ['www/secrets.yaml'] })).statusCode, 403);
    assert.equal((await commit({ message: 'No', paths: ['www/nessuno.js'] })).statusCode, 400);
    // Solo alcuni file, anche oltre i primi 200 mostrati.
    const res = await commit({ message: 'Alcuni', paths: ['grande/f000.js', 'grande/f249.js'] });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().files, 2);
    assert.equal(gitOut('ls-files'), 'grande/f000.js\ngrande/f249.js');
    // La cartella e un suo file insieme non si contano due volte.
    const both = await commit({ message: 'Www', paths: ['www/', 'www/a.js'] });
    assert.equal(both.statusCode, 200, both.body);
    assert.equal(both.json().files, 3);
    assert.equal(gitOut('ls-files', 'www'), 'www/a.js\nwww/b.js\nwww/sotto/c.js');
  });

  it('Includi di nuovo: l\'ultima esclusione toglie anche il titolo', async () => {
    await call('POST', '/api/git/init');
    await writeFile(path.join(sb.configDir, '.gitignore'), '*.db\r\n');
    await mkdir(path.join(sb.configDir, 'x'));
    await writeFile(path.join(sb.configDir, 'x/a.yaml'), 'a\n');
    await app.inject({ method: 'POST', url: '/api/git/ignore', payload: { path: 'x/' }, remoteAddress: INGRESS });
    await app.inject({ method: 'POST', url: '/api/git/unignore', payload: { line: '/x/' }, remoteAddress: INGRESS });
    assert.equal(await readFile(path.join(sb.configDir, '.gitignore'), 'utf8'), '*.db\r\n');
  });

  it('il titolo in italiano delle versioni precedenti vale ancora (niente doppioni, se ne va con l\'ultima riga)', async () => {
    await call('POST', '/api/git/init');
    const old = '# Esclusi con EDITHA (occhio barrato nel pannello Git)';
    await writeFile(path.join(sb.configDir, '.gitignore'), `*.db\n\n${old}\n/a/\n`);
    await mkdir(path.join(sb.configDir, 'b'));
    await writeFile(path.join(sb.configDir, 'b/x.yaml'), 'x\n');
    await app.inject({ method: 'POST', url: '/api/git/ignore', payload: { path: 'b/' }, remoteAddress: INGRESS });
    assert.equal(await readFile(path.join(sb.configDir, '.gitignore'), 'utf8'), `*.db\n\n${old}\n/a/\n/b/\n`);
    await app.inject({ method: 'POST', url: '/api/git/unignore', payload: { line: '/a/' }, remoteAddress: INGRESS });
    await app.inject({ method: 'POST', url: '/api/git/unignore', payload: { line: '/b/' }, remoteAddress: INGRESS });
    assert.equal(await readFile(path.join(sb.configDir, '.gitignore'), 'utf8'), '*.db\n');
  });

  it('Includi: uno spazio protetto in fondo resta; dice se un\'altra regola esclude ancora', async () => {
    await call('POST', '/api/git/init');
    await writeFile(path.join(sb.configDir, '.gitignore'), '*.log\n');
    await writeFile(path.join(sb.configDir, 'a '), 'x');
    await writeFile(path.join(sb.configDir, 'b.log'), 'x');
    const ignore = (p: string) => app.inject({ method: 'POST', url: '/api/git/ignore', payload: { path: p }, remoteAddress: INGRESS });
    const unignore = (line: string) => app.inject({ method: 'POST', url: '/api/git/unignore', payload: { line }, remoteAddress: INGRESS });
    await writeFile(path.join(sb.configDir, 'c.yaml'), 'c');
    await ignore('c.yaml');
    await ignore('a ');
    assert.equal((await unignore('/c.yaml')).json().stillIgnored, false);
    assert.ok((await readFile(path.join(sb.configDir, '.gitignore'), 'utf8')).endsWith('/a\\ \n'));
    assert.equal((await call('GET', '/api/git/status')).json().files.some((f: { path: string }) => f.path === 'a '), false);
    await ignore('b.log');
    assert.equal((await unignore('/b.log')).json().stillIgnored, true);
  });
});
