import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import type { Config } from '../src/config.js';

export interface Sandbox {
  /** Contiene config/, data/ e outside/ (fuori dalla radice). */
  base: string;
  configDir: string;
  dataDir: string;
  outsideDir: string;
  cleanup(): Promise<void>;
}

export async function makeSandbox(): Promise<Sandbox> {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'editha-test-')));
  const configDir = path.join(base, 'config');
  const dataDir = path.join(base, 'data');
  const outsideDir = path.join(base, 'outside');
  await Promise.all([mkdir(configDir), mkdir(dataDir), mkdir(outsideDir)]);
  return { base, configDir, dataDir, outsideDir, cleanup: () => rm(base, { recursive: true, force: true }) };
}

/** Crea i file indicati (percorso relativo → contenuto) con le cartelle intermedie. */
export async function writeTree(root: string, files: Record<string, string | Buffer>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
}

export function testConfig(sandbox: Sandbox, overrides: Partial<Config> = {}): Config {
  return {
    configDir: sandbox.configDir,
    dataDir: sandbox.dataDir,
    host: '127.0.0.1',
    port: 0,
    allowedIps: ['172.30.32.2'],
    maxFileSize: 1024 * 1024,
    backupKeep: 50,
    maxTransfer: 2 * 1024 * 1024,
    logLevel: 'silent',
    webDir: path.join(sandbox.base, 'web'),
    haUrl: 'http://127.0.0.1:9/api',
    haToken: '',
    ...overrides,
  };
}
