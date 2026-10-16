// Bundle dell'interfaccia con esbuild in versione WebAssembly: nessun binario nativo,
// stesso risultato su amd64 e aarch64 (ENG-7, FEP #17).
import { context, build } from 'esbuild-wasm';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
// Ogni build ha un identificativo: il browser scarica subito il nuovo app.js dopo un aggiornamento.
const buildId = Date.now().toString(36);
// Versione dell'add-on da config.yaml (accanto alla cartella web, o copiato nell'immagine).
let version = 'dev';
for (const file of ['../config.yaml', 'config.yaml']) {
  try {
    version = /^version:\s*"?([^"\n]+)"?/m.exec(await readFile(file, 'utf8'))?.[1] ?? version;
    break;
  } catch {
    // prova il percorso successivo
  }
}
await writeFile(`${outdir}/index.html`, (await readFile('public/index.html', 'utf8')).replace('__BUILD__', buildId));

const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outfile: `${outdir}/app.js`,
  minify: !watch,
  sourcemap: watch,
  legalComments: 'linked',
  define: { __EDITHA_VERSION__: JSON.stringify(version) },
  logLevel: 'info',
};

// Icone MDI per l'autocompletamento di "mdi:": nome → disegno, caricato solo quando serve.
const mdi = await import('@mdi/js');
const kebab = (name) =>
  name
    .slice(3)
    .replace(/([a-zA-Z])(\d)/g, '$1-$2')
    .replace(/([A-Z])/g, '-$1')
    .replace(/^-/, '')
    .toLowerCase();
const icons = {};
for (const [key, path] of Object.entries(mdi)) if (key.startsWith('mdi') && typeof path === 'string') icons[kebab(key)] = path;
await writeFile(`${outdir}/mdi-icons.json`, JSON.stringify(icons));

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
  // Versioni compresse servite direttamente dal server (preCompressed).
  for (const file of ['app.js', 'index.html', 'mdi-icons.json']) {
    const data = await readFile(`${outdir}/${file}`);
    await writeFile(`${outdir}/${file}.gz`, gzipSync(data, { level: 9 }));
    await writeFile(
      `${outdir}/${file}.br`,
      // Il file delle icone è grande: qualità un po' più bassa, molto più veloce (build su aarch64 emulato).
      brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: data.length > 1_000_000 ? 9 : 11 } }),
    );
  }
}
