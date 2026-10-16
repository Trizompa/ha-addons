import { api } from '../api/client.js';
import type { SecretKey } from '../api/types.js';

const TTL = 15_000;
const cache = new Map<string, { at: number; keys: Promise<SecretKey[]> }>();

/** Chiavi di !secret per un file, con una breve cache (secrets.yaml cambia di rado). */
export function secretKeys(path: string): Promise<SecretKey[]> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL) return hit.keys;
  const keys = api.secrets(path).then(
    (r) => r.secrets,
    () => [],
  );
  cache.set(path, { at: Date.now(), keys });
  return keys;
}

/** Dopo il salvataggio di un secrets.yaml le chiavi vanno rilette. */
export function forgetSecrets(): void {
  cache.clear();
}
