# Sviluppo di Editha

## Server (`editha/server`)

TypeScript su Node.js 22, framework [Fastify](https://fastify.dev). Nessuna dipendenza
nativa: la compilazione produce solo JavaScript, identico su `amd64` e `aarch64` (ENG-7).

```sh
cd editha/server
npm ci
npm test          # compila e lancia i test (node:test)
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

| Metodo e percorso | Corpo / query | Risposta |
| --- | --- | --- |
| `GET /api/health` | | `{ status: "ok" }` |
| `GET /api/tree` | `?path=` | `{ path, entries: Entry[] }`, cartelle prima |
| `GET /api/file` | `?path=` | `{ path, content, etag, size, mtime, readOnly }` |
| `PUT /api/file` | `{ path, content, etag }` | `{ path, etag, size, mtime }`; 409 `conflict` se il file è cambiato |
| `POST /api/file` | `{ path, type: "file" \| "directory", content? }` | 201 con l'`Entry` creata |
| `POST /api/rename` | `{ from, to }` | `Entry` nella nuova posizione |
| `DELETE /api/file` | `?path=` | `{ path, backup }` |
| `GET /api/download` | `?path=` | Il file, o la cartella come ZIP (`Content-Disposition: attachment`) |
| `POST /api/upload` | `?dir=&name=&overwrite=`, corpo `application/octet-stream` | 201 con l'`Entry`; 409 `already_exists` senza `overwrite` |
| `GET /api/versions` | `?path=` | `{ path, versions: Version[] }`, dalla più recente |

Codici di errore: `invalid_request` (400), `forbidden_path` / `read_only` /
`forbidden_origin` (403), `not_found` (404), `already_exists` / `conflict` (409),
`not_a_file` / `not_a_directory` (400), `too_large` (413), `binary` (415).

## Interfaccia (`editha/web`)

[Lit](https://lit.dev) per i componenti, [CodeMirror 6](https://codemirror.net) per l'editor,
bundle con `esbuild-wasm` (WebAssembly: nessun binario nativo, stesso risultato su ogni
architettura). I colori stanno in variabili CSS in `public/index.html`: il cambio di tema
cambia solo l'attributo `data-theme`.

```sh
cd editha/web
npm ci
npm run typecheck
npm test          # test unitari: tab, validatore YAML, percorsi
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
| `GET /api/settings` | | Impostazioni (tema, albero, a capo, carattere) |
| `POST /api/settings` | campi da cambiare | Impostazioni aggiornate (POST e non PATCH: alcuni reverse proxy bloccano PATCH) |
| `GET /api/snippets` / `PUT /api/snippets` | `{ snippets: [{ id, name, body }] }` | Snippet personali |
| `POST /api/search` | `{ query, regex?, caseSensitive?, wholeWord? }` | `{ results: [{ path, matches: [{ line, column, length, text }] }], files, matches, truncated }` |
| `POST /api/replace` | `{ paths, query, replacement, regex?, caseSensitive?, wholeWord? }` | `{ files: [{ path, count, etag }], skipped: [{ path, reason }] }` |
| `GET /api/folders` | | `{ folders }`: cartelle scrivibili, destinazioni di "Sposta in…" (lo spostamento usa `POST /api/rename`) |
| `GET /api/secrets?path=` | | `{ secrets: [{ key, path, line }] }`: chiavi di !secret visibili dal file, mai i valori |
| `GET /api/drafts` | | `{ drafts: [{ path, content, etag, savedAt }] }`: modifiche non salvate |
| `PUT /api/draft` / `DELETE /api/draft?path=` | `{ path, content, etag }` | Conserva o scarta la bozza di un file |
| `GET /api/version?path=&id=` | | Testo di una versione conservata |
| `POST /api/restore` | `{ path, id }` | Ripristina una versione (quella sostituita resta nella cronologia) |
| `POST /api/copy` | `{ from, to }` | Duplica un file; la destinazione non deve esistere |
| `GET /api/ha/status` | | `{ available }` |
| `GET /api/ha/entities` / `GET /api/ha/services` | `?fresh=true` per saltare la cache | Entità e azioni di HA |
| `POST /api/ha/check` | | `{ valid, errors, warnings }` |
| `POST /api/ha/reload` / `POST /api/ha/restart` | | Verifica e poi ricarica / riavvia; 409 `config_invalid` con gli errori |
| `GET /api/session` | | `{ tabs, active }` |
| `PUT /api/session` | `{ tabs: [{ path, anchor, head, scrollTop }], active }` | La sessione salvata |

## Immagine

`editha/Dockerfile` usa la base image di HA indicata in `build.yaml`. La CI
(`.github/workflows/editha.yaml`) esegue i test, costruisce l'immagine per `amd64` e
`aarch64` e controlla che il server risponda.

Build locale:

```sh
docker build -t editha editha
```
