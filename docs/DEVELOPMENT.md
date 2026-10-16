# Sviluppo di Editha

## Server (`editha/server`)

TypeScript su Node.js 22, framework [Fastify](https://fastify.dev). Nessuna dipendenza
nativa: la compilazione produce solo JavaScript, identico su `amd64` e `aarch64` (ENG-7).

```sh
cd editha/server
npm ci
npm test          # compila e lancia i test (node:test, in test/: app, backups, files, ha, paths, state, transfer)
npm run typecheck
npm run build     # produce dist/
```

Avvio locale su una cartella di prova:

```sh
EDITHA_CONFIG_DIR=/percorso/config-di-prova \
EDITHA_DATA_DIR=/percorso/data-di-prova \
EDITHA_ALLOWED_IPS=127.0.0.1 \
EDITHA_PORT=8099 \
npm start
```

### Variabili d'ambiente

| Variabile | Predefinito | Uso |
| --- | --- | --- |
| `EDITHA_CONFIG_DIR` | `/config` | Cartella esposta all'editor |
| `EDITHA_DATA_DIR` | `/data` | Dati privati dell'add-on (backup in `backups/`) |
| `EDITHA_HOST` | `0.0.0.0` | Indirizzo su cui ascolta il server |
| `EDITHA_PORT` | `8099` | Porta Ingress (deve coincidere con `ingress_port`) |
| `EDITHA_ALLOWED_IPS` | `172.30.32.2` | Indirizzi accettati, separati da virgola |
| `EDITHA_MAX_FILE_SIZE` | `5242880` | Byte massimi di un file aperto o salvato |
| `EDITHA_MAX_TRANSFER` | `52428800` | Byte massimi per upload e download (ZIP comprese) |
| `EDITHA_BACKUP_KEEP` | `10` | Versioni conservate per file |
| `EDITHA_LOG_LEVEL` | `info` | Livello di log |
| `EDITHA_WEB_DIR` | `/app/web` | Interfaccia compilata |
| `EDITHA_HA_URL` | `http://supervisor/core/api` | API di Home Assistant Core |
| `EDITHA_HA_TOKEN` | `SUPERVISOR_TOKEN` | Token per le API di Core (fornito dal Supervisor) |

### API

Tutti i percorsi sono relativi a `/config`, in formato POSIX (`packages/luci.yaml`);
`""` è la radice. Gli errori hanno la forma
`{ "error": { "code": "...", "message": "...", "details": { ... } } }`.

Le richieste sono validate con Ajv senza conversioni di tipo (`coerceTypes: false`) e senza
campi sconosciuti: nella query i booleani sono le stringhe `'true'` / `'false'` (`overwrite`,
`fresh`).

| Metodo e percorso | Corpo / query | Risposta |
| --- | --- | --- |
| `GET /api/health` | | `{ status: "ok", build }`: `build` identifica l'interfaccia installata (`"dev"` senza build); la pagina lo confronta per accorgersi di un aggiornamento |
| `GET /api/tree` | `?path=` | `{ path, entries: Entry[] }`, cartelle prima |
| `GET /api/file` | `?path=` | `{ path, content, etag, size, mtime, readOnly }` |
| `PUT /api/file` | `{ path, content, etag }` | `{ path, etag, size, mtime }`; 409 `conflict` se il file è cambiato, 413 oltre `EDITHA_MAX_FILE_SIZE` |
| `POST /api/file` | `{ path, type: "file" \| "directory", content? }` | 201 con l'`Entry` creata |
| `POST /api/rename` | `{ from, to }` | `Entry` nella nuova posizione; la cronologia segue il file o la cartella |
| `DELETE /api/file` | `?path=` | `{ path, backup }`; `backup` è `null` se l'elemento supera `EDITHA_MAX_TRANSFER` (eliminato senza copia) |
| `GET /api/download` | `?path=` | Il file, o la cartella come ZIP (`Content-Disposition: attachment`); 413 `too_large` oltre `EDITHA_MAX_TRANSFER` |
| `GET /api/preview` | `?path=` | Immagine o PDF con il proprio Content-Type, `inline` (FS-10); 415 `not_previewable` per gli altri file, 413 `too_large` oltre `EDITHA_MAX_TRANSFER`. Gli SVG hanno una CSP `sandbox`. |
| `POST /api/upload` | `?dir=&name=&overwrite=true\|false`, corpo `application/octet-stream` | 201 con l'`Entry`; 409 `already_exists` senza `overwrite`; 413 oltre `EDITHA_MAX_TRANSFER` |
| `GET /api/versions` | `?path=` | `{ path, versions: Version[] }`, dalla più recente |

Codici di errore: `invalid_request` / `not_a_file` / `not_a_directory` (400),
`forbidden_path` / `read_only` / `forbidden_origin` (403), `not_found` (404),
`already_exists` / `conflict` / `config_invalid` (409), `too_large` (413), `binary` /
`not_previewable` (415), `internal` (500, dettagli solo nel log), `ha_error` (502),
`ha_unavailable` (503), `no_space` (507, disco pieno).

## Interfaccia (`editha/web`)

[Lit](https://lit.dev) per i componenti, [CodeMirror 6](https://codemirror.net) per l'editor,
bundle con `esbuild-wasm` (WebAssembly: nessun binario nativo, stesso risultato su ogni
architettura). I colori stanno in variabili CSS in `public/index.html`: il cambio di tema
cambia solo l'attributo `data-theme`.

```sh
cd editha/web
npm ci
npm run typecheck
npm test          # test unitari (test/): connessione, i18n, schema, snippet, tab, validatore YAML
npm run build     # produce dist/ (con versioni .gz e .br)
npm run watch     # ricompila a ogni modifica
npm run test:e2e  # compila server e interfaccia e lancia i test nel browser
```

Per i test nel browser serve Chromium (`npx playwright install chromium`). Ogni test
corrisponde a un requisito o a una issue di File Editor Plus (`e2e/editha.spec.ts`).

Per provare l'interfaccia a mano: `npm run build`, poi avviare il server come sopra con
`EDITHA_WEB_DIR=../web/dist` e aprire `http://127.0.0.1:8099/`.

### API usate dall'interfaccia, oltre a quelle dei file

| Metodo e percorso | Corpo | Risposta |
| --- | --- | --- |
| `GET /api/settings` | | Impostazioni (tema, lingua, albero, a capo, carattere, cartelle di sistema, schema) |
| `POST /api/settings` | campi da cambiare | Impostazioni aggiornate (POST e non PATCH: alcuni reverse proxy bloccano PATCH) |
| `GET /api/snippets` / `PUT /api/snippets` | `{ snippets: [{ id, name, body }] }` | Snippet personali |
| `POST /api/search` | `{ query, regex?, caseSensitive?, wholeWord? }` | `{ results: [{ path, matches: [{ line, column, length, text, offset }] }], files, matches, truncated }`; `offset` è la posizione di `text` nella riga (righe lunghe accorciate). Salta cartelle di sistema, collegamenti, file oltre `EDITHA_MAX_FILE_SIZE`, binari e `secrets*.yaml` (anche `.bak`) |
| `POST /api/replace` | `{ paths, query, replacement, regex?, caseSensitive?, wholeWord? }` | `{ files: [{ path, count, etag }], skipped: [{ path, reason }] }`; `reason` è un codice di errore (`read_only` per `secrets*.yaml`, `conflict`, `too_large`…) |
| `GET /api/folders` | | `{ folders }`: cartelle scrivibili, destinazioni di "Sposta in…" (lo spostamento usa `POST /api/rename`) |
| `GET /api/secrets?path=` | | `{ secrets: [{ key, path, line }] }`: chiavi di !secret visibili dal file, mai i valori |
| `GET /api/drafts` | | `{ drafts: [{ path, content, etag, savedAt }] }`: modifiche non salvate |
| `PUT /api/draft` / `DELETE /api/draft?path=` | `{ path, content, etag }` | Conserva o scarta la bozza di un file |
| `GET /api/version?path=&id=` | | Testo di una versione conservata |
| `POST /api/restore` | `{ path, id }` | `{ path, etag, size, mtime }`: ripristina una versione, anche di un file eliminato (quella sostituita resta nella cronologia). 413 se la versione supera `EDITHA_MAX_FILE_SIZE` o il file attuale `EDITHA_MAX_TRANSFER`; le versioni di cartelle danno `not_a_file` |
| `POST /api/copy` | `{ from, to }` | 201 con l'`Entry`: duplica un file o una cartella (link copiati come link, fino a `EDITHA_MAX_TRANSFER`); la destinazione non deve esistere. L'interfaccia duplica solo file |
| `GET /api/ha/status` | | `{ available }` |
| `GET /api/ha/entities` / `GET /api/ha/services` | `?fresh=true` per saltare la cache | Entità e azioni di HA |
| `POST /api/ha/check` | | `{ valid, errors, warnings }` |
| `POST /api/ha/reload` / `POST /api/ha/restart` | | `{ ok, warnings }`: verifica e poi ricarica / riavvia; 409 `config_invalid` con gli errori |
| `GET /api/session` | | `{ tabs, active, side? }` |
| `PUT /api/session` | `{ tabs: [{ path, anchor, head, scrollTop }], active, side? }` | La sessione salvata; `side` è il file nella colonna destra della vista divisa |

## Immagine

`editha/Dockerfile` usa la base image di HA indicata in `build.yaml`. La CI
(`.github/workflows/editha.yaml`) esegue i test, costruisce l'immagine per `amd64` e
`aarch64` e controlla che il server risponda.

Build locale:

```sh
docker build -t editha editha
```
