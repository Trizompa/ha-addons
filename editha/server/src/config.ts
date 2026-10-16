import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

/** Indirizzo del proxy Ingress del Supervisor. */
export const INGRESS_PROXY_IP = '172.30.32.2';

export interface Config {
  /** Cartella esposta all'editor. */
  configDir: string;
  /** Cartella privata dell'add-on (impostazioni, backup). */
  dataDir: string;
  host: string;
  port: number;
  /** Indirizzi da cui sono accettate le richieste (SEC-1). */
  allowedIps: string[];
  /** Dimensione massima, in byte, di un file aperto o salvato nell'editor (SEC-5). */
  maxFileSize: number;
  /** Dimensione massima di upload e download, file binari e archivi ZIP compresi (FS-6). */
  maxTransfer: number;
  /** Versioni conservate per ogni file (BK-5). */
  backupKeep: number;
  logLevel: string;
  /** File compilati dell'interfaccia (index.html, app.js). */
  webDir: string;
  /** API di Home Assistant Core (tramite il proxy del Supervisor). */
  haUrl: string;
  /** Token per le API di Core; vuoto se Editha gira fuori da Home Assistant. */
  haToken: string;
}

/** Nell'immagine: /app/dist/config.js → /app/web */
const DEFAULT_WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} deve essere un intero positivo`);
  return n;
}

/**
 * Token per le API di Core. Il Supervisor lo passa come SUPERVISOR_TOKEN, ma l'avvio
 * tramite s6-overlay (immagini base di HA) può non trasmetterlo al processo: s6 lo
 * conserva comunque in /run/s6/container_environment.
 */
export function supervisorToken(env: NodeJS.ProcessEnv, s6EnvDir = '/run/s6/container_environment'): string {
  const direct = env.EDITHA_HA_TOKEN || env.SUPERVISOR_TOKEN || env.HASSIO_TOKEN;
  if (direct) return direct;
  for (const name of ['SUPERVISOR_TOKEN', 'HASSIO_TOKEN']) {
    try {
      const value = readFileSync(path.join(s6EnvDir, name), 'utf8').trim();
      if (value) return value;
    } catch {
      // file assente: si prova il successivo
    }
  }
  return '';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    configDir: env.EDITHA_CONFIG_DIR || '/config',
    dataDir: env.EDITHA_DATA_DIR || '/data',
    host: env.EDITHA_HOST || '0.0.0.0',
    port: positiveInt(env.EDITHA_PORT, 8099, 'EDITHA_PORT'),
    allowedIps: (env.EDITHA_ALLOWED_IPS || INGRESS_PROXY_IP)
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean),
    maxFileSize: positiveInt(env.EDITHA_MAX_FILE_SIZE, 5 * 1024 * 1024, 'EDITHA_MAX_FILE_SIZE'),
    maxTransfer: positiveInt(env.EDITHA_MAX_TRANSFER, 50 * 1024 * 1024, 'EDITHA_MAX_TRANSFER'),
    backupKeep: positiveInt(env.EDITHA_BACKUP_KEEP, 10, 'EDITHA_BACKUP_KEEP'),
    logLevel: env.EDITHA_LOG_LEVEL || 'info',
    webDir: env.EDITHA_WEB_DIR || DEFAULT_WEB_DIR,
    haUrl: (env.EDITHA_HA_URL || 'http://supervisor/core/api').replace(/\/+$/, ''),
    haToken: supervisorToken(env),
  };
}
