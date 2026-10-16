import { extension } from './paths.js';

export type PreviewKind = 'image' | 'pdf';

// Stessi tipi dell'anteprima lato server (server/src/fs/preview.ts).
const IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg']);

/** FS-10: i file che si mostrano in anteprima invece di aprirsi nell'editor. */
export function previewKind(path: string): PreviewKind | null {
  const ext = extension(path);
  if (IMAGES.has(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  return null;
}
