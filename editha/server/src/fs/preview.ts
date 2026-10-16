import path from 'node:path';

/** Tipi che il browser sa mostrare da solo: immagini e PDF. */
const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
};

/** Content-Type dell'anteprima di un file, oppure null se il browser non può mostrarlo. */
export function previewType(file: string): string | null {
  return TYPES[path.posix.extname(file).slice(1).toLowerCase()] ?? null;
}
