import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { BackupStore } from '../src/backups/store.js';
import { EdithaError } from '../src/errors.js';
import { etagOf, FileService } from '../src/fs/files.js';
import { PathGuard } from '../src/fs/paths.js';
import { makeSandbox, writeTree, type Sandbox } from './helpers.js';

function rejectsWith(code: string) {
  return (err: unknown) => err instanceof EdithaError && err.code === code;
}

describe('FileService', () => {
  let sb: Sandbox;
  let files: FileService;
  let backups: BackupStore;

  beforeEach(async () => {
    sb = await makeSandbox();
    await writeTree(sb.configDir, {
      'configuration.yaml': 'homeassistant:\n  name: Casa\n',
      'automations.yaml': '[]\n',
      'packages/lights.yaml': 'light: []\n',
      'packages/Zeta.yaml': '',
      'www/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]),
      '.storage/core.config': '{}',
    });
    const guard = await PathGuard.create(sb.configDir);
    backups = new BackupStore(path.join(sb.dataDir, 'backups'), 50);
    files = new FileService(guard, backups, 1024);
  });

  afterEach(() => sb.cleanup());

  const abs = (rel: string) => path.join(sb.configDir, rel);

  describe('list', () => {
    it('BK-7: spazio della cronologia, con i file eliminati segnalati', async () => {
    await writeFile(path.join(sb.configDir, 'resta.yaml'), 'a: 1\n');
    await writeFile(path.join(sb.configDir, 'via.yaml'), 'b: 1\n');
    const r = await files.read('resta.yaml');
    await files.write('resta.yaml', 'a: 2\n', r.etag);
    await files.remove('via.yaml');
    // Una cronologia con l'indice rovinato resta senza nome.
    await mkdir(path.join(sb.dataDir, 'backups', 'rovinata'), { recursive: true });
    await writeFile(path.join(sb.dataDir, 'backups', 'rovinata', '20261015T080000000Z-save'), 'x');
    await writeFile(path.join(sb.dataDir, 'backups', 'rovinata', 'index.json'), '{');
    const usage = await files.historyUsage();
    assert.equal(usage.fileCount, 3);
    assert.equal(usage.keep, 50);
    const byPath = new Map(usage.files.map((f) => [f.path, f]));
    assert.equal(byPath.get('resta.yaml')?.exists, true);
    assert.equal(byPath.get('via.yaml')?.exists, false);
    assert.equal(byPath.get(null)?.exists, false);
    assert.equal(usage.versions, 3);
  });

  it('mette le cartelle prima dei file e ordina per nome', async () => {
      const root = await files.list('');
      assert.deepEqual(
        root.map((e) => e.name),
        ['.storage', 'packages', 'www', 'automations.yaml', 'configuration.yaml'],
      );
      assert.equal(root.find((e) => e.name === '.storage')?.readOnly, true);
      assert.equal(root.find((e) => e.name === 'packages')?.readOnly, false);
    });

    it('restituisce percorsi relativi', async () => {
      const entries = await files.list('packages');
      assert.deepEqual(
        entries.map((e) => e.path),
        ['packages/lights.yaml', 'packages/Zeta.yaml'],
      );
    });

    it('mostra i link verso l\'esterno come voci non utilizzabili', async () => {
      await symlink(sb.outsideDir, abs('escape'));
      const entry = (await files.list('')).find((e) => e.name === 'escape');
      assert.equal(entry?.type, 'other');
      assert.equal(entry?.readOnly, true);
    });

    it('nasconde i file temporanei di salvataggio', async () => {
      await writeFile(abs('.editha-abc123.tmp'), '');
      assert.equal((await files.list('')).some((e) => e.name.startsWith('.editha-')), false);
    });

    it('rifiuta un file al posto di una cartella', async () => {
      await assert.rejects(files.list('configuration.yaml'), rejectsWith('not_a_directory'));
    });

    it('segna le cartelle vuote (i file temporanei non contano)', async () => {
      await mkdir(abs('vuota'));
      await mkdir(abs('quasi'));
      await writeFile(abs('quasi/.editha-abc123.tmp'), '');
      const root = await files.list('');
      assert.equal(root.find((e) => e.name === 'vuota')?.empty, true);
      assert.equal(root.find((e) => e.name === 'quasi')?.empty, true);
      assert.equal(root.find((e) => e.name === 'packages')?.empty, false);
      assert.equal(root.find((e) => e.name === 'configuration.yaml')?.empty, undefined);
    });
  });

  describe('read', () => {
    it('restituisce contenuto ed etag', async () => {
      const f = await files.read('configuration.yaml');
      assert.equal(f.content, 'homeassistant:\n  name: Casa\n');
      assert.equal(f.etag, etagOf(Buffer.from(f.content)));
      assert.equal(f.readOnly, false);
    });

    it('rifiuta i file binari', async () => {
      await assert.rejects(files.read('www/logo.png'), rejectsWith('binary'));
    });

    it('rifiuta i file troppo grandi', async () => {
      await writeFile(abs('big.log'), 'x'.repeat(2048));
      await assert.rejects(files.read('big.log'), rejectsWith('too_large'));
    });

    it('rifiuta le cartelle', async () => {
      await assert.rejects(files.read('packages'), rejectsWith('not_a_file'));
    });

    it('consente di leggere le cartelle protette', async () => {
      const f = await files.read('.storage/core.config');
      assert.equal(f.readOnly, true);
    });
  });

  describe('write', () => {
    it('salva, conserva la versione precedente e restituisce il nuovo etag', async () => {
      const before = await files.read('automations.yaml');
      const res = await files.write('automations.yaml', '- id: test\n', before.etag);
      assert.equal(await readFile(abs('automations.yaml'), 'utf8'), '- id: test\n');
      assert.equal(res.etag, etagOf(Buffer.from('- id: test\n')));

      const versions = await files.versions('automations.yaml');
      assert.equal(versions.length, 1);
      assert.equal(versions[0]?.reason, 'save');
      assert.equal((await backups.read('automations.yaml', versions[0]!.id)).toString(), '[]\n');
    });

    it('rifiuta il salvataggio se il file è cambiato su disco (SEC-4)', async () => {
      const before = await files.read('automations.yaml');
      await writeFile(abs('automations.yaml'), '# modificato altrove\n');
      await assert.rejects(files.write('automations.yaml', 'mio\n', before.etag), (err: unknown) => {
        assert.ok(err instanceof EdithaError);
        assert.equal(err.code, 'conflict');
        assert.equal(err.details?.etag, etagOf(Buffer.from('# modificato altrove\n')));
        return true;
      });
      assert.equal(await readFile(abs('automations.yaml'), 'utf8'), '# modificato altrove\n');
    });

    it('non crea versioni se il contenuto non cambia', async () => {
      const before = await files.read('automations.yaml');
      await files.write('automations.yaml', before.content, before.etag);
      assert.equal((await files.versions('automations.yaml')).length, 0);
    });

    it('mantiene i permessi e non lascia file temporanei (SEC-3)', async () => {
      await chmod(abs('automations.yaml'), 0o600);
      const before = await files.read('automations.yaml');
      await files.write('automations.yaml', 'nuovo\n', before.etag);
      assert.equal((await stat(abs('automations.yaml'))).mode & 0o777, 0o600);
      assert.deepEqual((await readdir(sb.configDir)).filter((n) => n.endsWith('.tmp')), []);
    });

    it('serializza salvataggi concorrenti: il secondo con lo stesso etag va in conflitto', async () => {
      const before = await files.read('automations.yaml');
      const results = await Promise.allSettled([
        files.write('automations.yaml', 'A\n', before.etag),
        files.write('automations.yaml', 'B\n', before.etag),
      ]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
    });

    it('scrive nel file reale quando si passa da un link interno', async () => {
      await symlink(abs('packages'), abs('pkg-link'));
      const before = await files.read('pkg-link/lights.yaml');
      await files.write('pkg-link/lights.yaml', 'light: [1]\n', before.etag);
      assert.equal(await readFile(abs('packages/lights.yaml'), 'utf8'), 'light: [1]\n');
      assert.equal((await files.versions('packages/lights.yaml')).length, 1);
    });

    it('rifiuta le cartelle protette e i contenuti troppo grandi', async () => {
      const f = await files.read('.storage/core.config');
      await assert.rejects(files.write('.storage/core.config', '{"a":1}', f.etag), rejectsWith('read_only'));
      const g = await files.read('automations.yaml');
      await assert.rejects(files.write('automations.yaml', 'x'.repeat(2048), g.etag), rejectsWith('too_large'));
    });

    it('mantiene il BOM iniziale', async () => {
      await writeFile(abs('bom.yaml'), '﻿a: 1\n');
      const f = await files.read('bom.yaml');
      assert.equal(f.content, '﻿a: 1\n');
      await files.write('bom.yaml', f.content.replace('1', '2'), f.etag);
      assert.equal(await readFile(abs('bom.yaml'), 'utf8'), '﻿a: 2\n');
    });
  });

  describe('create', () => {
    it('crea file e cartelle, anche dentro cartelle vuote (FEP #11)', async () => {
      await files.create('nuova', 'directory');
      const entry = await files.create('nuova/scene.yaml', 'file', '[]\n');
      assert.equal(entry.path, 'nuova/scene.yaml');
      assert.equal(entry.type, 'file');
      assert.equal(await readFile(abs('nuova/scene.yaml'), 'utf8'), '[]\n');
    });

    it('non sovrascrive', async () => {
      await assert.rejects(files.create('automations.yaml', 'file'), rejectsWith('already_exists'));
      await assert.rejects(files.create('packages', 'directory'), rejectsWith('already_exists'));
      assert.equal(await readFile(abs('automations.yaml'), 'utf8'), '[]\n');
    });

    it('richiede che la cartella esista', async () => {
      await assert.rejects(files.create('manca/file.yaml', 'file'), rejectsWith('not_found'));
    });

    it('rifiuta percorsi esterni o protetti', async () => {
      await assert.rejects(files.create('../fuori.yaml', 'file'), rejectsWith('forbidden_path'));
      await assert.rejects(files.create('.storage/x', 'file'), rejectsWith('read_only'));
    });
  });

  describe('rename', () => {
    it('rinomina un file e sposta la sua cronologia (FEP #18)', async () => {
      const f = await files.read('automations.yaml');
      await files.write('automations.yaml', 'v2\n', f.etag);
      const entry = await files.rename('automations.yaml', 'packages/automazioni.yaml');
      assert.equal(entry.path, 'packages/automazioni.yaml');
      assert.equal(await readFile(abs('packages/automazioni.yaml'), 'utf8'), 'v2\n');
      assert.equal((await files.versions('packages/automazioni.yaml')).length, 1);
      assert.equal((await files.versions('automations.yaml')).length, 0);
    });

    it('rinomina una cartella', async () => {
      await files.rename('packages', 'pacchetti');
      assert.equal(await readFile(abs('pacchetti/lights.yaml'), 'utf8'), 'light: []\n');
    });

    it('non sovrascrive la destinazione', async () => {
      await assert.rejects(files.rename('automations.yaml', 'configuration.yaml'), rejectsWith('already_exists'));
      assert.equal(await readFile(abs('configuration.yaml'), 'utf8'), 'homeassistant:\n  name: Casa\n');
    });

    it('non sposta una cartella dentro sé stessa', async () => {
      await files.create('packages/sub', 'directory');
      await assert.rejects(files.rename('packages', 'packages/sub/packages'), rejectsWith('invalid_request'));
    });

    it('rifiuta sorgenti mancanti, la radice e le cartelle protette', async () => {
      await assert.rejects(files.rename('manca.yaml', 'x.yaml'), rejectsWith('not_found'));
      await assert.rejects(files.rename('', 'x'), rejectsWith('forbidden_path'));
      await assert.rejects(files.rename('.storage', 'storage'), rejectsWith('read_only'));
      await assert.rejects(files.rename('automations.yaml', '.storage/a.yaml'), rejectsWith('read_only'));
    });
  });

  describe('remove', () => {
    it('elimina un file conservandone una copia (FS-4)', async () => {
      const res = await files.remove('packages/lights.yaml');
      await assert.rejects(stat(abs('packages/lights.yaml')));
      assert.ok(res.backup);
      const versions = await files.versions('packages/lights.yaml');
      assert.equal(versions[0]?.reason, 'delete');
      assert.equal((await backups.read('packages/lights.yaml', versions[0]!.id)).toString(), 'light: []\n');
    });

    it('elimina una cartella conservandone una copia completa', async () => {
      await files.remove('packages');
      await assert.rejects(stat(abs('packages')));
      const versions = await files.versions('packages');
      assert.equal(versions[0]?.kind, 'directory');
      const copy = path.join(backups.dir, (await readdir(backups.dir))[0]!, versions[0]!.id, 'lights.yaml');
      assert.equal(await readFile(copy, 'utf8'), 'light: []\n');
    });

    it('elimina un link senza toccare la destinazione', async () => {
      await symlink(sb.outsideDir, abs('escape'));
      await files.remove('escape');
      assert.ok((await stat(sb.outsideDir)).isDirectory());
    });

    it('rifiuta la radice, le cartelle protette e i percorsi mancanti', async () => {
      await assert.rejects(files.remove(''), rejectsWith('forbidden_path'));
      await assert.rejects(files.remove('.storage/core.config'), rejectsWith('read_only'));
      await assert.rejects(files.remove('manca.yaml'), rejectsWith('not_found'));
    });
  });

  describe('versioni e ripristino (BK-3, BK-4)', () => {
    async function saveTwice() {
      const first = await files.read('automations.yaml');
      const second = await files.write('automations.yaml', '- id: "1"\n', first.etag);
      await files.write('automations.yaml', '- id: "2"\n', second.etag);
      return files.versions('automations.yaml');
    }

    it('restituisce il testo di una versione', async () => {
      const versions = await saveTwice();
      assert.equal(versions.length, 2);
      const oldest = await files.versionContent('automations.yaml', versions[1]!.id);
      assert.equal(oldest.content, '[]\n');
    });

    it('ripristina una versione conservando quella sostituita', async () => {
      const versions = await saveTwice();
      const res = await files.restore('automations.yaml', versions[1]!.id);
      assert.equal(await readFile(abs('automations.yaml'), 'utf8'), '[]\n');
      assert.equal(res.etag, etagOf(Buffer.from('[]\n')));
      const after = await files.versions('automations.yaml');
      assert.equal(after[0]?.reason, 'restore');
      assert.equal((await backups.read('automations.yaml', after[0]!.id)).toString(), '- id: "2"\n');
    });

    it('ricrea un file eliminato', async () => {
      await files.remove('packages/lights.yaml');
      const [deleted] = await files.versions('packages/lights.yaml');
      await files.restore('packages/lights.yaml', deleted!.id);
      assert.equal(await readFile(abs('packages/lights.yaml'), 'utf8'), 'light: []\n');
    });

    it('rifiuta versioni inesistenti, cartelle e percorsi protetti', async () => {
      await assert.rejects(files.versionContent('automations.yaml', '20260101T000000000Z-save'), rejectsWith('not_found'));
      await assert.rejects(files.versionContent('automations.yaml', '../../etc/passwd'), rejectsWith('not_found'));
      await files.remove('packages');
      const [dir] = await files.versions('packages');
      await assert.rejects(files.versionContent('packages', dir!.id), rejectsWith('not_a_file'));
      await assert.rejects(files.restore('.storage/core.config', 'x'), rejectsWith('read_only'));
    });
  });

  describe('copy (FS-8)', () => {
    it('duplica un file senza toccare l\'originale', async () => {
      const entry = await files.copy('automations.yaml', 'automations_copia.yaml');
      assert.equal(entry.path, 'automations_copia.yaml');
      assert.equal(await readFile(abs('automations_copia.yaml'), 'utf8'), '[]\n');
      assert.equal(await readFile(abs('automations.yaml'), 'utf8'), '[]\n');
    });

    it('duplica una cartella con tutto il contenuto', async () => {
      await files.copy('packages', 'packages_copia');
      assert.equal(await readFile(abs('packages_copia/lights.yaml'), 'utf8'), 'light: []\n');
    });

    it('non sovrascrive e non copia dentro sé stessa', async () => {
      await assert.rejects(files.copy('automations.yaml', 'configuration.yaml'), rejectsWith('already_exists'));
      await assert.rejects(files.copy('packages', 'packages/dentro'), rejectsWith('invalid_request'));
      await assert.rejects(files.copy('automations.yaml', '.storage/x'), rejectsWith('read_only'));
      await assert.rejects(files.copy('manca.yaml', 'altro.yaml'), rejectsWith('not_found'));
    });
  });

  describe('secrets (HA-4, SEC-7)', () => {
    it('elenca solo le chiavi, dal secrets.yaml più vicino', async () => {
      await writeTree(sb.configDir, {
        'secrets.yaml': '# commento\nwifi_password: segreta\napi_key: "abc"\n"con spazi": 1\nlista:\n  - x\n',
        'packages/secrets.yaml': 'api_key: locale\nsolo_qui: 2\n',
      });
      const root = await files.secrets('configuration.yaml');
      assert.deepEqual(
        root.map((s) => s.key),
        ['api_key', 'con spazi', 'lista', 'wifi_password'],
      );
      assert.equal(root.find((s) => s.key === 'wifi_password')?.line, 2);
      const nested = await files.secrets('packages/lights.yaml');
      assert.equal(nested.find((s) => s.key === 'api_key')?.path, 'packages/secrets.yaml');
      assert.ok(nested.some((s) => s.key === 'wifi_password'));
      assert.ok(!JSON.stringify(nested).includes('segreta'));
    });

    it('nessun secrets.yaml: elenco vuoto', async () => {
      assert.deepEqual(await files.secrets('configuration.yaml'), []);
    });
  });

  describe('folders (FS-5)', () => {
    it('elenca le cartelle scrivibili, senza quelle di sistema né i link', async () => {
      await writeTree(sb.configDir, { 'packages/sub/x.yaml': '', 'www/img/a.png': '' });
      await symlink(sb.outsideDir, abs('fuori'));
      assert.deepEqual(await files.folders(), ['packages', 'packages/sub', 'www', 'www/img']);
    });
  });

  describe('findNames (FS-12)', () => {
    it('trova i nomi in tutte le cartelle, anche mai aperte, senza sistema né link', async () => {
      await writeTree(sb.configDir, {
        'packages/heating.yaml': '',
        'packages/sub/Heater_bagno.yaml': '',
        'heat/x.yaml': '',
        '.storage/heating_secret': '',
        'backup/.storage/heating': '',
        'custom/.git/heat_obj': '',
        'altro.yaml': '',
      });
      await symlink(sb.outsideDir, abs('heat_link'));
      const res = await files.findNames('HEAT');
      assert.deepEqual(res, {
        paths: ['heat', 'packages/heating.yaml', 'packages/sub/Heater_bagno.yaml'],
        truncated: false,
        incomplete: false,
      });
      assert.deepEqual((await files.findNames('   ')).paths, []);
    });

    it('si ferma al limite e lo dice', async () => {
      await writeTree(sb.configDir, { 'a/uno.yaml': '', 'a/due.yaml': '', 'a/tre.yaml': '' });
      const res = await files.findNames('.yaml', 2);
      assert.equal(res.paths.length, 2);
      assert.equal(res.truncated, true);
      assert.equal(res.incomplete, false);
    });

    it('su una /config troppo grande dice che la ricerca è incompleta, non che i risultati sono troppi', async () => {
      await writeTree(sb.configDir, { 'a/uno.yaml': '', 'a/due.yaml': '', 'b/zz.yaml': '' });
      const res = await files.findNames('zz', 300, 3);
      assert.deepEqual([res.truncated, res.incomplete], [false, true]);
    });
  });

  describe('rename come spostamento (FS-5)', () => {
    it('sposta un file in un\'altra cartella portando la cronologia', async () => {
      const f = await files.read('automations.yaml');
      await files.write('automations.yaml', '- a\n', f.etag);
      await files.rename('automations.yaml', 'packages/automations.yaml');
      assert.equal(await readFile(abs('packages/automations.yaml'), 'utf8'), '- a\n');
      assert.equal((await files.versions('packages/automations.yaml')).length, 1);
    });
  });

  describe('search (SR-1, SR-2, SR-4)', () => {
    beforeEach(async () => {
      await writeTree(sb.configDir, {
        'automations.yaml': '- alias: Luce\n  entity_id: light.cucina\n  target: light.cucina_2\n',
        'packages/t.yaml': 'value: "{{ states.light.cucina.state }}"\nLIGHT.CUCINA maiuscolo\n',
        '.storage/core.entity_registry': 'light.cucina',
        'secrets.yaml': 'token: light.cucina\n',
      });
    });

    it('trova il testo in tutti i file, con riga e colonna, escluse le cartelle di sistema e i binari', async () => {
      const res = await files.search({ query: 'light.cucina' });
      const paths = res.results.map((r) => r.path);
      assert.deepEqual(paths, ['automations.yaml', 'packages/t.yaml']);
      const first = res.results[0]!.matches[0]!;
      assert.deepEqual([first.line, first.column, first.length], [2, 14, 12]);
      assert.equal(res.matches, 4);
    });

    it('distingue maiuscole e parole intere (riferimenti a un\'entità)', async () => {
      const exact = await files.search({ query: 'light.cucina', caseSensitive: true, wholeWord: true });
      assert.equal(exact.matches, 2);
      assert.ok(exact.results.every((r) => r.matches.every((m) => !m.text.includes('LIGHT') || m.column !== 1)));
    });

    it('accetta le espressioni regolari e rifiuta quelle non valide', async () => {
      const res = await files.search({ query: 'light\\.cucina(_\\d)?', regex: true, caseSensitive: true });
      assert.equal(res.matches, 3);
      await assert.rejects(files.search({ query: '(', regex: true }), rejectsWith('invalid_request'));
    });

    it('un\'espressione regolare lentissima non blocca il server: la ricerca si ferma', async () => {
      await writeTree(sb.configDir, { 'lento.txt': 'a'.repeat(40) + '!\n' });
      const started = Date.now();
      const res = await files.search({ query: '(a+)+$', regex: true });
      assert.equal(res.truncated, true);
      assert.ok(Date.now() - started < 12_000);
    });
  });

  describe('correzioni della revisione', () => {
    it('due spostamenti verso lo stesso nome: uno solo riesce, nessun file perso', async () => {
      await writeTree(sb.configDir, { 'a.txt': 'AAA', 'b.txt': 'BBB' });
      const results = await Promise.allSettled([files.rename('a.txt', 'c.txt'), files.rename('b.txt', 'c.txt')]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      const left = (await readdir(sb.configDir)).filter((n) => ['a.txt', 'b.txt', 'c.txt'].includes(n));
      assert.equal(left.length, 2);
    });

    it('spostando una cartella la cronologia dei file al suo interno la segue', async () => {
      const f = await files.read('packages/lights.yaml');
      await files.write('packages/lights.yaml', 'light: [x]\n', f.etag);
      await files.rename('packages', 'pacchetti');
      assert.equal((await files.versions('pacchetti/lights.yaml')).length, 1);
    });

    it('le chiavi di secrets.yaml non includono pezzi di valori su più righe', async () => {
      await writeTree(sb.configDir, { 'secrets.yaml': '\uFEFFprima: 1\nk2: "multi\nline: segreto"\nultima: 3\n' });
      const keys = (await files.secrets('configuration.yaml')).map((k) => k.key);
      // «line» fa parte del valore di k2: non deve mai comparire come chiave.
      assert.ok(!keys.includes('line'));
      assert.deepEqual(keys.slice(0, 2), ['k2', 'prima']);
      await writeTree(sb.configDir, { 'secrets.yaml': '\uFEFFprima: 1\nk2: |\n  multi\n  line: segreto\nultima: 3\n' });
      const ok = await files.secrets('configuration.yaml');
      assert.deepEqual(ok.map((k) => [k.key, k.line]), [['k2', 2], ['prima', 1], ['ultima', 5]]);
    });

    it('la cronologia di un file aperto tramite collegamento è quella del file reale', async () => {
      await symlink(abs('automations.yaml'), abs('link.yaml'));
      const f = await files.read('automations.yaml');
      await files.write('automations.yaml', '- x\n', f.etag);
      assert.equal((await files.versions('link.yaml')).length, 1);
    });

    it('un file o una cartella oltre il limite si eliminano senza copia solo con noBackup', async () => {
      const small = new FileService(await PathGuard.create(sb.configDir), backups, 1024, 4);
      await writeTree(sb.configDir, { 'grande.bin': 'x'.repeat(10), 'dir/a.txt': 'x'.repeat(10) });
      await assert.rejects(small.remove('grande.bin'), (err: unknown) => {
        assert.ok(err instanceof EdithaError && err.code === 'no_backup' && err.status === 409);
        assert.equal(err.details?.size, 10);
        assert.equal(err.details?.limit, 4);
        return true;
      });
      await stat(abs('grande.bin'));
      await assert.rejects(small.remove('dir'), rejectsWith('no_backup'));
      await stat(abs('dir/a.txt'));
      assert.equal((await small.remove('grande.bin', { noBackup: true })).backup, null);
      assert.equal((await small.remove('dir', { noBackup: true })).backup, null);
      await assert.rejects(stat(abs('grande.bin')));
      await assert.rejects(stat(abs('dir')));
    });
  });

  describe('correzioni della seconda revisione', () => {
    it('rifiuta un contenuto con surrogati isolati invece di salvarlo con \uFFFD', async () => {
      const f = await files.read('automations.yaml');
      await assert.rejects(files.write('automations.yaml', 'x: \uD83D\n', f.etag), rejectsWith('invalid_request'));
      assert.equal(await readFile(abs('automations.yaml'), 'utf8'), '[]\n');
    });

    it('ripristina una versione più grande del limite dell\'editor, con i permessi originali', async () => {
      const big = 'x'.repeat(4096);
      await writeTree(sb.configDir, { 'grande.txt': big });
      await chmod(abs('grande.txt'), 0o600);
      const { backup } = await files.remove('grande.txt');
      assert.ok(backup);
      await files.restore('grande.txt', backup);
      assert.equal(await readFile(abs('grande.txt'), 'utf8'), big);
      assert.equal((await stat(abs('grande.txt'))).mode & 0o777, 0o600);
    });

    it('la ricerca dà il totale senza limiti, uguale al conteggio della sostituzione', async () => {
      await writeTree(sb.configDir, { 'molti.txt': 'ab '.repeat(300) + '\n' + 'x'.repeat(12_000) + 'ab\n' });
      const svc = new FileService(await PathGuard.create(sb.configDir), backups, 64 * 1024);
      const res = await svc.search({ query: 'ab', caseSensitive: true });
      const file = res.results.find((r) => r.path === 'molti.txt')!;
      assert.equal(file.matches.length, 200);
      assert.equal(file.total, 301);
      const rep = await svc.replace(['molti.txt'], { query: 'ab', caseSensitive: true }, 'cd');
      assert.equal(rep.files[0]?.count, 301);
    });

    it('la ricerca salta .storage, .cloud e .git a qualunque profondità e le copie di secrets.yaml', async () => {
      await writeTree(sb.configDir, {
        'sub/.git/config': 'parola_rara',
        'sub/.storage/x': 'parola_rara',
        'secrets.yaml_copy.bak': 'parola_rara',
        'secret.yaml': 'parola_rara',
        'sub/ok.yaml': 'parola_rara',
      });
      const res = await files.search({ query: 'parola_rara' });
      assert.deepEqual(res.results.map((r) => r.path), ['sub/ok.yaml']);
    });

    it('la sostituzione salta i file invariati e segnala binari e codifica', async () => {
      await writeTree(sb.configDir, {
        'same.yaml': 'a: x\n',
        'bin.dat': Buffer.from([0x78, 0x00, 0x01]),
        'emoji.txt': 'ciao 😀\n',
      });
      const same = await files.replace(['same.yaml'], { query: 'x' }, 'x');
      assert.deepEqual(same, { files: [], skipped: [] });
      assert.equal((await files.versions('same.yaml')).length, 0);
      const bin = await files.replace(['bin.dat'], { query: 'x' }, 'y');
      assert.deepEqual(bin.skipped, [{ path: 'bin.dat', reason: 'binary' }]);
      // "\-" non è valido con u: in modalità classica \uD83D trova metà della coppia.
      const enc = await files.replace(['emoji.txt'], { query: '\\uD83D|\\-zz', regex: true }, 'X');
      assert.deepEqual(enc.skipped, [{ path: 'emoji.txt', reason: 'encoding' }]);
      assert.equal(await readFile(abs('emoji.txt'), 'utf8'), 'ciao 😀\n');
    });

    it('caricare sopra un file oltre il limite richiede noBackup; il file caricato non supera il limite', async () => {
      const small = new FileService(await PathGuard.create(sb.configDir), backups, 1024, 8);
      await writeTree(sb.configDir, { 'g.bin': 'x'.repeat(10), 'p.bin': 'yy' });
      await assert.rejects(small.upload('', 'nuovo.bin', Buffer.alloc(9), false), rejectsWith('too_large'));
      await assert.rejects(stat(abs('nuovo.bin')));
      await assert.rejects(small.upload('', 'g.bin', Buffer.from('z'), true), rejectsWith('no_backup'));
      assert.equal(await readFile(abs('g.bin'), 'utf8'), 'x'.repeat(10));
      const forced = await small.upload('', 'g.bin', Buffer.from('z'), true, true);
      assert.equal(forced.backup, null);
      const kept = await small.upload('', 'p.bin', Buffer.from('z'), true);
      assert.ok(kept.backup);
      assert.equal((await files.versionContent('p.bin', kept.backup)).content, 'yy');
    });

    it('una copia interrotta non lascia una destinazione a metà', async () => {
      await writeTree(sb.configDir, { 'src/a.txt': 'a' });
      // Una FIFO fa fallire fs.cp dopo aver già creato la cartella di destinazione.
      execFileSync('mkfifo', [abs('src/pipe')]);
      await assert.rejects(files.copy('src', 'dst'));
      await assert.rejects(stat(abs('dst')));
    });

    it('un no-op ripetuto non riempie la cronologia', async () => {
      const keep2 = new BackupStore(path.join(sb.dataDir, 'b2'), 2);
      const svc = new FileService(await PathGuard.create(sb.configDir), keep2, 1024);
      await writeTree(sb.configDir, { 'h.yaml': 'v1' });
      let f = await svc.read('h.yaml');
      await svc.write('h.yaml', 'v2', f.etag);
      const first = (await svc.versions('h.yaml'))[0]!.id;
      // Ripristino e annullamento ripetuti: la versione "v1" resta.
      for (let i = 0; i < 3; i++) await svc.restore('h.yaml', first);
      assert.equal(await readFile(abs('h.yaml'), 'utf8'), 'v1');
      assert.ok((await svc.versions('h.yaml')).some((v) => v.id === first));
      f = await svc.read('h.yaml');
      assert.equal(f.content, 'v1');
    });
  });

  describe('operazioni su cartelle e file insieme', () => {
    it('un salvataggio e l\'eliminazione della sua cartella non perdono il testo salvato', async () => {
      // Arrivano insieme: vince chi prende il lock per primo, e l'ordine dipende dal disco. Se il
      // salvataggio arriva prima riesce e la copia della cartella eliminata contiene il testo nuovo;
      // se arriva dopo fallisce (niente "salvato" su un file sparito). Mai salvato e perso.
      for (let round = 0; round < 5; round++) {
        await writeTree(sb.configDir, { 'packages/lights.yaml': 'light: []\n' });
        const f = await files.read('packages/lights.yaml');
        const [removed, saved] = await Promise.allSettled([
          files.remove('packages'),
          files.write('packages/lights.yaml', 'light: [1]\n', f.etag),
        ]);
        assert.equal(removed.status, 'fulfilled');
        if (saved.status === 'fulfilled' && removed.status === 'fulfilled') {
          const id = removed.value.backup!;
          const copy = path.join(backups.dir, createHash('sha256').update('packages').digest('hex'), id, 'lights.yaml');
          assert.equal(await readFile(copy, 'utf8'), 'light: [1]\n');
        }
      }
    });
  });

  describe('replace (SR-3)', () => {
    it('sostituisce nei file indicati, conservando la versione precedente', async () => {
      await writeTree(sb.configDir, {
        'a.yaml': 'entity_id: light.cucina\nx: light.cucina_2\n',
        'b.yaml': 'target: light.cucina\r\n',
        'secrets.yaml': 'k: light.cucina\n',
      });
      const res = await files.replace(['a.yaml', 'b.yaml', 'secrets.yaml', '.storage/core.config'], { query: 'light.cucina', wholeWord: true, caseSensitive: true }, 'light.salotto');
      assert.deepEqual(res.files.map((f) => [f.path, f.count]).sort(), [['a.yaml', 1], ['b.yaml', 1]]);
      assert.equal(await readFile(abs('a.yaml'), 'utf8'), 'entity_id: light.salotto\nx: light.cucina_2\n');
      assert.equal(await readFile(abs('b.yaml'), 'utf8'), 'target: light.salotto\r\n');
      assert.equal(await readFile(abs('secrets.yaml'), 'utf8'), 'k: light.cucina\n');
      assert.deepEqual(res.skipped.map((s) => s.path).sort(), ['.storage/core.config', 'secrets.yaml']);
      assert.equal((await files.versions('a.yaml')).length, 1);
    });

    it('con le espressioni regolari usa i gruppi ($1) e non interpreta $ nel testo semplice', async () => {
      await writeTree(sb.configDir, { 'c.yaml': 'temp_1: a\ntemp_2: b\n' });
      await files.replace(['c.yaml'], { query: 'temp_(\\d)', regex: true }, 'sensore_$1');
      assert.equal(await readFile(abs('c.yaml'), 'utf8'), 'sensore_1: a\nsensore_2: b\n');
      await files.replace(['c.yaml'], { query: 'sensore_1' }, 'costo_$1');
      assert.equal(await readFile(abs('c.yaml'), 'utf8'), 'costo_$1: a\nsensore_2: b\n');
    });

    it('con lookahead, lookbehind e $<nome> sostituisce esattamente la corrispondenza', async () => {
      await writeTree(sb.configDir, { 'd.yaml': 'abc\nentity_id: light.x\nfoobar foobaz\n' });
      const res = await files.replace(['d.yaml'], { query: '(?<=a)bc|c', regex: true }, 'X');
      assert.equal(res.files[0]?.count, 1);
      assert.equal(await readFile(abs('d.yaml'), 'utf8'), 'aX\nentity_id: light.x\nfoobar foobaz\n');
      await files.replace(['d.yaml'], { query: '(?<=entity_id: )light\\.x', regex: true }, 'light.y');
      await files.replace(['d.yaml'], { query: 'foo(?=bar)', regex: true }, 'FOO');
      await files.replace(['d.yaml'], { query: '(?<p>fo)o(?<s>baz)', regex: true }, '$<s>-$<p>-$&-$$');
      assert.equal(await readFile(abs('d.yaml'), 'utf8'), 'aX\nentity_id: light.y\nFOObar baz-fo-foobaz-$\n');
    });

    it('secrets.yaml non si tocca nemmeno da un link o da una copia', async () => {
      await writeTree(sb.configDir, { 'secrets.yaml': 'pw: vecchia\n', 'secrets_copia.yaml.bak': 'pw: vecchia\n' });
      await symlink(abs('secrets.yaml'), abs('s.yaml'));
      const res = await files.replace(['s.yaml', 'secrets_copia.yaml.bak'], { query: 'vecchia' }, 'nuova');
      assert.equal(res.files.length, 0);
      assert.equal(await readFile(abs('secrets.yaml'), 'utf8'), 'pw: vecchia\n');
      assert.equal(await readFile(abs('secrets_copia.yaml.bak'), 'utf8'), 'pw: vecchia\n');
      // Nemmeno la ricerca le mostra.
      assert.equal((await files.search({ query: 'vecchia' })).results.length, 0);
    });

    it('non scrive un risultato oltre il limite dei file e conta una volta lo stesso file', async () => {
      await writeTree(sb.configDir, { 'big.txt': 'a\n'.repeat(200), 'e.yaml': 'x: 1\n' });
      const big = await files.replace(['big.txt'], { query: 'a' }, 'b'.repeat(20));
      assert.deepEqual(big.skipped, [{ path: 'big.txt', reason: 'too_large' }]);
      assert.equal(await readFile(abs('big.txt'), 'utf8'), 'a\n'.repeat(200));
      const twice = await files.replace(['e.yaml', './e.yaml'], { query: 'x' }, 'y');
      assert.deepEqual(twice.files.map((f) => f.path), ['e.yaml']);
      assert.deepEqual(twice.skipped, []);
    });

    it('un\'espressione lentissima non modifica nessun file', async () => {
      await writeTree(sb.configDir, { 'lento.txt': 'a'.repeat(40) + '!\n' });
      await assert.rejects(files.replace(['lento.txt'], { query: '(a+)+$', regex: true }, 'x'), rejectsWith('invalid_request'));
      assert.equal(await readFile(abs('lento.txt'), 'utf8'), 'a'.repeat(40) + '!\n');
    });
  });
});
