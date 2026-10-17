// Bundle dell'interfaccia con esbuild in versione WebAssembly: nessun binario nativo,
// stesso risultato su amd64 e aarch64 (ENG-7, FEP #17).
import { build, context, formatMessages } from 'esbuild-wasm';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
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
  // Nella build normale i messaggi li stampa questo script: esbuild-wasm, se scrive da sé su uno
  // stderr che è un file (es. `npm run build > log`), entra in un ciclo e muore con
  // «RangeError: Invalid array length». In watch il terminale va bene così.
  logLevel: watch ? 'info' : 'silent',
};

// Icone MDI per l'autocompletamento di "mdi:": nome → disegno, caricato solo quando serve.
const mdi = await import('@mdi/js');
// Nome JS come lo genera @mdi/js: «-x» diventa «X», «-5» diventa «5».
const jsName = (name) => 'mdi' + name.replace(/-(\w)/g, (_m, c) => c.toUpperCase()).replace(/^./, (c) => c.toUpperCase());
// I nomi ufficiali stanno in @mdi/svg/meta.json; senza quel pacchetto si ricavano dal nome JS,
// che però è ambiguo con le cifre («moleculeCo2», «surroundSound51»): quelle eccezioni sono qui.
const MDI_DIGIT_NAMES = [
  ...['4', '6', '8', '10', '12', '20'].flatMap((n) => [`dice-d${n}`, `dice-d${n}-outline`]),
  'ev-plug-ccs1', 'ev-plug-ccs2', 'ev-plug-type1', 'ev-plug-type2',
  ...Array.from({ length: 12 }, (_v, i) => `keyboard-f${i + 1}`),
  'language-css3', 'language-html5', 'molecule-co2',
  'surround-sound-2-0', 'surround-sound-2-1', 'surround-sound-3-1', 'surround-sound-5-1', 'surround-sound-5-1-2', 'surround-sound-7-1',
];
let official = null;
try {
  const meta = JSON.parse(await readFile(createRequire(import.meta.url).resolve('@mdi/svg/meta.json'), 'utf8'));
  official = new Map(meta.map((icon) => [jsName(icon.name), icon.name]));
} catch {
  // @mdi/svg non installato: conversione inversa più le eccezioni note.
}
const exceptions = new Map(MDI_DIGIT_NAMES.map((name) => [jsName(name), name]));
const kebab = (key) =>
  official?.get(key) ??
  exceptions.get(key) ??
  key
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
  let result;
  try {
    result = await build(options);
  } catch (err) {
    const errors = await formatMessages(err.errors ?? [], { kind: 'error' }).catch(() => [String(err)]);
    process.stderr.write(errors.join(''));
    process.exit(1);
  }
  const warnings = await formatMessages(result.warnings, { kind: 'warning' });
  if (warnings.length) process.stderr.write(warnings.join(''));
  console.log(`  ${outdir}/app.js  ${((await stat(`${outdir}/app.js`)).size / 1048576).toFixed(1)} MB`);
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
