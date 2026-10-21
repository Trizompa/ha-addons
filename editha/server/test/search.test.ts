import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { EdithaError, fromFsError } from '../src/errors.js';
import { writeFileAtomic } from '../src/fs/atomic.js';
import { buildSearchRegExp, isSecretsFile, replaceInText } from '../src/fs/search.js';
import { makeSandbox, type Sandbox } from './helpers.js';

describe('isSecretsFile (SEC-7)', () => {
  it('riconosce secrets.yaml e le sue copie', () => {
    for (const name of [
      'secrets.yaml',
      'Secrets.YAML',
      'secrets.yml',
      'secret.yaml',
      'secrets_copy.yaml.bak',
      'secrets.yaml_copy.bak',
      'secrets_copy.yaml_copy.bak',
      'secrets.yaml.old',
      'secrets.yaml~',
      'secrets.yaml.orig',
      'secrets_old.yaml',
      'secrets2.yaml',
      '.secrets.yaml',
      '.secrets.yaml.swp',
      '#secrets.yaml#',
      'secret_old.yaml',
      'secret.yaml.bak',
      'secrets_esphome.yaml',
      'secretsold.yaml',
      'SecretsCopy.yml',
      'old_secrets.yaml',
      '20240101_secrets.yaml',
      'Copy of secrets.yaml',
      'my_secrets.yaml',
    ]) {
      assert.equal(isSecretsFile(name), true, name);
    }
  });

  it('non tocca gli altri file', () => {
    for (const name of ['secret_sensors.yaml', 'secret-door.yaml', 'secret_garage_automation.yml', 'secretary.yaml', 'my_secrets_notes.txt', 'secrets.json', 'configuration.yaml', 'secrets']) {
      assert.equal(isSecretsFile(name), false, name);
    }
  });
});

describe('buildSearchRegExp (SR-1)', () => {
  it('usa il flag u quando può, con parole intere Unicode', () => {
    const re = buildSearchRegExp({ query: 'citt', wholeWord: true });
    assert.equal(re.unicode, true);
    assert.equal('la città'.match(re), null);
    assert.equal('la città'.match(buildSearchRegExp({ query: 'città', wholeWord: true }))?.[0], 'città');
    assert.equal('perché_x'.match(buildSearchRegExp({ query: 'perché', wholeWord: true })), null);
  });

  it('torna alla modalità classica se l\'espressione non è valida con u', () => {
    const re = buildSearchRegExp({ query: 'a\\-b', regex: true, wholeWord: true });
    assert.equal(re.unicode, false);
    assert.equal('x a-b y'.match(re)?.[0], 'a-b');
    assert.throws(() => buildSearchRegExp({ query: '(', regex: true }), (err: unknown) => err instanceof EdithaError && err.code === 'invalid_request');
  });

  it('il testo semplice resta letterale anche con u', () => {
    const re = buildSearchRegExp({ query: 'a.b{1}(x)[y]\\', caseSensitive: true });
    assert.equal(re.unicode, true);
    assert.equal('-a.b{1}(x)[y]\\-'.match(re)?.[0], 'a.b{1}(x)[y]\\');
  });
});

describe('replaceInText (SR-3)', () => {
  it('si ferma appena il risultato supera il limite, senza costruire stringhe enormi', () => {
    const line = 'a'.repeat(20_000);
    const started = Date.now();
    assert.equal(replaceInText(line, { query: 'a', regex: true }, '$`', 1_000_000), null);
    assert.ok(Date.now() - started < 2000);
    assert.equal(replaceInText('ab', { query: 'a' }, 'xyz', 3), null);
    assert.deepEqual(replaceInText('ab', { query: 'a' }, 'xy', 3), { content: 'xyb', count: 1 });
  });
});

describe('fromFsError', () => {
  const err = (code: string) => fromFsError(Object.assign(new Error(code), { code }), 'x') as EdithaError;

  it('dà codici chiari agli errori di disco e di cartelle cambiate', () => {
    assert.equal(err('ENOTEMPTY').code, 'busy');
    assert.equal(err('EBUSY').code, 'busy');
    assert.equal(err('EMFILE').code, 'busy');
    assert.equal(err('EIO').code, 'io_error');
    assert.equal(err('EIO').status, 500);
    assert.equal(err('EXDEV').code, 'cross_device');
    assert.equal(err('EEXIST').code, 'already_exists');
  });
});

describe('writeFileAtomic con controllo finale', () => {
  let sb: Sandbox;
  beforeEach(async () => {
    sb = await makeSandbox();
  });
  afterEach(() => sb.cleanup());

  it('non sovrascrive un file cambiato dopo il controllo e non lascia temporanei', async () => {
    const file = path.join(sb.configDir, 'a.yaml');
    await writeFile(file, 'uno\n');
    const st = await stat(file);
    // Un altro programma scrive (dimensione diversa: il controllo non dipende dalla precisione delle date).
    await writeFile(file, 'altro programma\n');
    await assert.rejects(
      writeFileAtomic(file, Buffer.from('editha\n'), { original: st, expect: st }),
      (e: unknown) => e instanceof EdithaError && e.code === 'conflict',
    );
    assert.equal(await readFile(file, 'utf8'), 'altro programma\n');
    assert.deepEqual(await readdir(sb.configDir), ['a.yaml']);
  });

  it('con expect null non sostituisce un file comparso nel frattempo', async () => {
    const file = path.join(sb.configDir, 'b.yaml');
    await writeFile(file, 'nuovo\n');
    await assert.rejects(writeFileAtomic(file, Buffer.from('x'), { expect: null }), (e: unknown) => e instanceof EdithaError && e.code === 'conflict');
    assert.equal(await readFile(file, 'utf8'), 'nuovo\n');
  });

  it('scrive normalmente se il file non è cambiato', async () => {
    const file = path.join(sb.configDir, 'c.yaml');
    await writeFile(file, 'uno\n');
    const st = await stat(file);
    await writeFileAtomic(file, Buffer.from('due\n'), { original: st, expect: st });
    assert.equal(await readFile(file, 'utf8'), 'due\n');
  });
});
