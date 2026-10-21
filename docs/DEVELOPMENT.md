# Sviluppo di EDITHA

## Server (`editha/server`)

TypeScript su Node.js 22, framework [Fastify](https://fastify.dev). Nessuna dipendenza
nativa: la compilazione produce solo JavaScript, identico su `amd64` e `aarch64` (ENG-7).

```sh
cd editha/server
npm ci
npm test          # compila e lancia i test (node:test, in test/: app, backups, files, git, ha, paths, search, state, transfer)
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
`noBackup`, `fresh`).

| Metodo e percorso | Corpo / query | Risposta |
| --- | --- | --- |
| `GET /api/health` | | `{ status: "ok", build }`: `build` identifica l'interfaccia installata (`"dev"` senza build); la pagina lo confronta per accorgersi di un aggiornamento |
| `GET /api/tree` | `?path=` | `{ path, entries: Entry[] }`, cartelle prima |
| `GET /api/file` | `?path=` | `{ path, content, etag, size, mtime, readOnly }` |
| `PUT /api/file` | `{ path, content, etag }` | `{ path, etag, size, mtime }`; 409 `conflict` (`details: { path, etag }`, etag attuale o `null`) se il file è cambiato, anche durante il salvataggio stesso (ricontrollato appena prima della rinomina); 413 oltre `EDITHA_MAX_FILE_SIZE`; 400 `invalid_request` se `content` non è UTF-16 ben formato (surrogati isolati) |
| `POST /api/file` | `{ path, type: "file" \| "directory", content? }` | 201 con l'`Entry` creata |
| `POST /api/rename` | `{ from, to }` | `Entry` nella nuova posizione; la cronologia segue il file o la cartella |
| `DELETE /api/file` | `?path=&noBackup=true\|false` | `{ path, backup }` con l'id della copia. Un file o una cartella oltre `EDITHA_MAX_TRANSFER` non ha copia: 409 `no_backup` (`details: { path, size, limit }`; per le cartelle `size` è un minimo) e nulla viene eliminato, a meno di `noBackup=true` (allora `backup: null`). I collegamenti si eliminano senza copia (`backup: null`) senza conferma |
| `GET /api/download` | `?path=` | Il file, o la cartella come ZIP (`Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`); 413 `too_large` oltre `EDITHA_MAX_TRANSFER`. Nello ZIP `\` e `:` nei nomi diventano `_`; scaricando la radice `.storage`, `.cloud`, `deps`, `tts` e `.git` restano fuori |
| `GET /api/preview` | `?path=` | Immagine o PDF con il proprio Content-Type, `inline` (FS-10); 415 `not_previewable` per gli altri file, 413 `too_large` oltre `EDITHA_MAX_TRANSFER`. Gli SVG hanno una CSP `sandbox`. |
| `POST /api/upload` | `?dir=&name=&overwrite=true\|false&noBackup=true\|false`, corpo `application/octet-stream` | 201 con `Entry & { backup }`: `backup` è l'id della copia del file sostituito, `null` per un file nuovo o con `noBackup`; 409 `already_exists` senza `overwrite`; 409 `no_backup` (`details: { path, size, limit }`) se il file da sostituire supera `EDITHA_MAX_TRANSFER` e manca `noBackup=true`; 413 se il corpo supera `EDITHA_MAX_TRANSFER` (prima di toccare il disco) |
| `GET /api/versions` | `?path=` | `{ path, versions: Version[] }`, dalla più recente |
| `GET /api/history/usage` | | `{ totalBytes, versions, fileCount, keep, files: [{ path, bytes, versions, oldest, newest, exists }] }`: spazio su disco della cronologia (blocchi occupati, indici e avanzi compresi), al massimo 200 file dai più pesanti; `path` null se l'indice è illeggibile |
| `POST /api/history/prune` | `{ olderThanDays?: 1…36500, before?: ISO, all?: true, dryRun }` | `{ versions, bytes, files: [{ path, versions, bytes, emptied }], failed: [path], leftovers: { count, bytes }, before }`: con `all` cancella tutto fino a `before` (o fino ad ora) compresi gli avanzi (cartelle senza versioni, scritture interrotte; solo cartelle con nome sha256); elimina (o con `dryRun` conta) le versioni più vecchie della soglia; con `olderThanDays` la soglia la calcola il server, una data futura dà 400; `before` nella risposta va rimandato tale e quale per eliminare esattamente ciò che l'anteprima ha mostrato. Mai i file di /config; il registro elenca fino a 50 percorsi |

Codici di errore: `invalid_request` / `not_a_file` / `not_a_directory` (400),
`forbidden_path` / `read_only` / `forbidden_origin` (403), `not_found` (404),
`already_exists` / `conflict` / `config_invalid` (409), `no_backup` (409, nessuna copia
possibile: ripetere con `noBackup=true` dopo la conferma), `busy` (409, percorso in uso o
cambiato durante l'operazione, es. una cartella riempita mentre la si elimina: riprovare),
`cross_device` (409, spostamento tra dischi diversi non supportato), `too_large` (413),
`binary` / `not_previewable` (415), `internal` (500, dettagli solo nel log), `io_error`
(500, errore di lettura/scrittura del disco), `ha_error` (502), `ha_unavailable` (503),
`no_space` (507, disco pieno).

Copie di sicurezza (BK-1): ogni versione si scrive con un nome temporaneo, si sincronizza su
disco e poi si rinomina, prima dell'operazione che la rende necessaria. Gli id crescono sempre
(anche se l'orologio torna indietro) e la versione appena creata non viene mai scartata. Un
contenuto uguale all'ultima versione non crea una versione nuova: si restituisce l'id esistente.

## Interfaccia (`editha/web`)

[Lit](https://lit.dev) per i componenti, [CodeMirror 6](https://codemirror.net) per l'editor,
bundle con `esbuild-wasm` (WebAssembly: nessun binario nativo, stesso risultato su ogni
architettura). I colori stanno in variabili CSS in `public/index.html`: il cambio di tema
cambia solo l'attributo `data-theme`.

```sh
cd editha/web
npm ci
npm run typecheck
npm test          # test unitari (in test/: connection, editor-review, i18n, jinja-template, keys, outline, snippets, tabs, yaml-lint)
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
| `POST /api/search` | `{ query, regex?, caseSensitive?, wholeWord? }` | `{ results: [{ path, matches: [{ line, column, length, text, offset }], total }], files, matches, truncated }`; `offset` è la posizione di `text` nella riga (righe lunghe accorciate). `matches` è limitato (200 per file, solo entro i primi 10.000 caratteri di una riga); `total` è il numero, senza limiti, di corrispondenze che `POST /api/replace` cambierebbe nel file (da mostrare nella conferma). Il totale `matches` della risposta resta la somma dei `matches` mostrati. Salta le cartelle di sistema al primo livello (`.storage`, `.cloud`, `.git` a qualunque profondità), collegamenti, file oltre `EDITHA_MAX_FILE_SIZE`, binari e i file segreti (vedi sotto) |
| `POST /api/replace` | `{ paths (al massimo 2500), query, replacement, regex?, caseSensitive?, wholeWord? }` | `{ files: [{ path, count, etag }], skipped: [{ path, reason }] }`; `files` elenca solo i file cambiati (un file in cui la sostituzione non cambia nulla, es. `a` → `a`, non compare né in `files` né in `skipped`). `reason` è un codice di errore (`read_only` per i file segreti, `conflict`, `too_large`, `not_found`…), `binary` (non è testo UTF-8), `encoding` (il risultato spezzerebbe un carattere, es. una regex senza `u` su metà di un'emoji) o `error` |
| `GET /api/folders` | | `{ folders }`: cartelle scrivibili, destinazioni di "Sposta in…" (lo spostamento usa `POST /api/rename`) |
| `GET /api/secrets?path=` | | `{ secrets: [{ key, path, line }] }`: chiavi di !secret visibili dal file, mai i valori |
| `GET /api/drafts` | | `{ drafts: [{ path, content, etag, savedAt, client?, live, idleMs }] }`: modifiche non salvate; `live` = la finestra che le ha scritte si è fatta sentire negli ultimi 90 s |
| `PUT /api/draft` / `DELETE /api/draft?path=&client=` | `{ path, content, etag, client? }` | Conserva o scarta la bozza di un file per una finestra (`client`, tenuto in sessionStorage); senza `client` la bozza di versioni precedenti. Mai per `secrets.yaml` e copie (403; `GET /api/drafts` e `claim` le ignorano) |
| `POST /api/draft/claim` | `{ path, from?, client }` | Prende per `client` la bozza scritta da `from` (assente: versione precedente), in un'unica operazione: `{ claimed: true, draft }`, oppure `{ claimed: false }` se un'altra finestra l'ha già presa o scartata |
| `POST /api/drafts/alive` | `{ client, closing? }` | La finestra è aperta (ogni 20 s e al ritorno in primo piano) o si sta chiudendo (`pagehide`) |
| `GET /api/version?path=&id=` | | Testo di una versione conservata |
| `POST /api/restore` | `{ path, id }` | `{ path, etag, size, mtime }`: ripristina una versione, anche di un file eliminato (ricreato con i permessi della copia; quella sostituita resta nella cronologia). 413 se la versione o il file attuale superano `EDITHA_MAX_TRANSFER`; 409 `conflict` se il file cambia durante il ripristino; le versioni di cartelle danno `not_a_file` |
| `POST /api/copy` | `{ from, to }` | 201 con l'`Entry`: duplica un file o una cartella (link copiati come link, fino a `EDITHA_MAX_TRANSFER`); la destinazione non deve esistere. Una copia non riuscita non lascia la destinazione a metà. L'interfaccia duplica solo file |
| `GET /api/ha/status` | | `{ available }` |
| `GET /api/ha/entities` / `GET /api/ha/services` | `?fresh=true` per saltare la cache | Entità e azioni di HA |
| `GET /api/git/info` | | `{ available, version, repo: 'none' \| 'ready' \| 'broken', branch, head: { hash, subject, date } \| null, gitignore }`: GIT-1, repository in /config (non nelle cartelle sopra) |
| `POST /api/git/init` | | `{ info, gitignoreCreated }`: `git init` (ramo main) e `.gitignore` di base se manca; 409 se c'è già `.git` |
| `GET /api/git/status` | | `{ files: [{ path, status: 'modified' \| 'added' \| 'deleted' \| 'conflict', blocked: 'secret' \| 'sensitive' \| 'filter' \| 'conflict' \| 'nested' \| null, folder?: { files, excluded, list }, untracked }], truncated, merging }`: GIT-2, cartelle nuove su una riga (`-unormal`), al massimo 2000 righe; `list` sono i primi 200 file che possono entrare nel commit, da scegliere uno per uno; il commit di una cartella include i suoi file tranne quelli bloccati |
| `POST /api/git/commit` | `{ message, paths: [...] }` oppure `{ message, all: true }`, più `folders?: { [cartella]: numero }` | `{ hash, subject, files, skipped }`: GIT-4, solo i file indicati (`--only`), anche singoli file dentro una cartella nuova (solo quelli che potrebbero entrare con la cartella); file bloccati (`blocked`): 403 se indicati, saltati con `all`; 409 durante un merge; percorsi passati da stdin; autore EDITHA se il repository non ne ha uno; `folders` è il numero di file visti per ogni cartella nuova: se nel frattempo è cambiato, 409 `conflict`. Filtri di `.gitattributes`, hook, firme e programmi esterni sempre spenti |
| `GET /api/git/head?path=` | | `{ path, content \| null }`: GIT-3, il file nell'ultimo commit (`cat-file blob`, senza filtri); 403 per segreti e dati interni |
| `GET /api/git/show?path=&rev=` | | come sopra per un commit qualsiasi (`rev`: codice esadecimale) |
| `GET /api/git/log?skip=` | | `{ commits: [{ hash, author, date, subject }], more }`: GIT-5, 50 per pagina |
| `GET /api/git/commit-files?rev=` | | `{ hash, files: [{ path, status, blocked }] }`: file toccati (`diff-tree`, primo genitore) |
| `POST /api/git/ignore` | `{ path }` | `{ ok }`: aggiunge `/<path>` (caratteri speciali protetti) al `.gitignore`, creato se manca; mai su un `.gitignore` che non è un file normale |
| `GET /api/git/ignored` | | `{ entries: [{ line, path }] }`: righe del `.gitignore` che iniziano con `/` (percorsi precisi, come le scrive Escludi) |
| `POST /api/git/unignore` | `{ line }` | `{ ok, stillIgnored }`: toglie esattamente quella riga (e il titolo di Escludi se resta vuoto); `stillIgnored` è vero se un'altra regola del `.gitignore` esclude ancora lo stesso percorso |
| `POST /api/git/gitignore` | | `{ info, created }`: `.gitignore` di base, mai sopra uno esistente |
| `GET /api/download/excluded?path=` | | `{ excluded: [path] }`: secrets.yaml e copie che lo ZIP di quella cartella lascerà fuori (SEC-7), al massimo 100 |
| `POST /api/ha/check` | | `{ valid, errors, warnings }` |
| `POST /api/ha/template` | `{ template, path? }` | `{ ok: true, result }` oppure `{ ok: false, kind: 'syntax' \| 'render', message }`: HA-7, rende il template con `POST /api/template` di Core. Serve `{{`, `{%` o `{#`; 403 per secrets.yaml e copie (anche tramite link); HA non indica la riga dell'errore |
| `POST /api/ha/reload` / `POST /api/ha/restart` | | `{ ok, warnings }`: verifica e poi ricarica / riavvia; 409 `config_invalid` con gli errori |
| `GET /api/session` | | `{ tabs, active, side? }` |
| `PUT /api/session` | `{ tabs: [{ path, anchor, head, scrollTop }], active, side? }` | La sessione salvata; `side` è il file nella colonna destra della vista divisa |

### Regola di ricerca e file segreti

L'espressione si costruisce con `buildSearchRegExp` (`editha/server/src/fs/search.ts`), che
l'interfaccia replica:

- testo semplice: la query con `.*+?^${}()|[]\` preceduti da `\`; con `regex` la query così com'è;
- flag `g`, più `i` senza `caseSensitive`, più `u` se l'espressione è valida con `u`;
  altrimenti si usa senza `u` (es. `\-` o `{` isolati);
- `wholeWord`: con `u` `(?<![\p{L}\p{N}_])(?:…)(?![\p{L}\p{N}_])` (lettere accentate comprese),
  senza `u` `(?<![\w])(?:…)(?![\w])` (solo ASCII);
- la ricerca e la sostituzione lavorano riga per riga (senza `\r` finale) e ignorano le
  corrispondenze vuote.

File segreti (SEC-7, mai in ricerca, sostituzione, ZIP delle cartelle, commit Git e anteprima
dei template): `isSecretsFile` in `editha/server/src/fs/search.ts`, sul nome del file, vero se
corrisponde a una di queste due espressioni:

- `/secrets[^/]*\.ya?ml/i`: `secrets` in un punto qualsiasi del nome, poi `.yaml`/`.yml` in un
  punto qualsiasi: `secrets.yaml`, `secrets.yml`, `secrets_copia.yaml.bak`, `secrets.yaml_copy.bak`,
  `secrets.yaml~`, `.secrets.yaml.swp`, `old_secrets.yaml`, `20240101_secrets.yaml`,
  `secretsold.yaml`, `secrets_esphome.yaml` (la stessa regola dei dati sensibili del pannello Git);
- `/^[.#~]?secret(?:[._~ -]?(?:\d+|bak|backup|old|orig|copy|copia|new|\(\d+\)))*\.ya?ml/i`: il
  singolare `secret` solo come copia: `secret.yaml`, `secret_old.yaml`, `secret (2).yaml`.

Non sono segreti `secretary.yaml`, `secret_sensors.yaml` né `mysecret.yaml`.

## Immagine

`editha/Dockerfile` usa la base image di HA indicata in `build.yaml`. La CI
(`.github/workflows/editha.yaml`) esegue i test, costruisce l'immagine per `amd64` e controlla
che il server risponda. La build `aarch64` è emulata (QEMU), lenta e consuma molti minuti di
GitHub Actions: parte solo a mano (Actions → Editha → *Run workflow*).

Build locale:

```sh
docker build -t editha editha
```
