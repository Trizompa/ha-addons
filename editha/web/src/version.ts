/** Sostituita da esbuild con la versione scritta in config.yaml. */
declare const __EDITHA_VERSION__: string | undefined;

export const VERSION = typeof __EDITHA_VERSION__ === 'string' ? __EDITHA_VERSION__ : 'dev';
