# Developing EDITHA

## Server (`editha/server`)

TypeScript on Node.js 22, [Fastify](https://fastify.dev) framework. No native dependencies:
the build produces only JavaScript, identical on `amd64` and `aarch64` (ENG-7).

```sh
cd editha/server
npm ci
npm test          # builds and runs the tests (node:test, in test/: app, backups, files, git, ha, paths, search, state, transfer)
npm run typecheck
npm run build     # produces dist/
```

Running locally on a test folder:

```sh
EDITHA_CONFIG_DIR=/path/test-config \
EDITHA_DATA_DIR=/path/test-data \
EDITHA_ALLOWED_IPS=127.0.0.1 \
EDITHA_PORT=8099 \
npm start
```

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `EDITHA_CONFIG_DIR` | `/config` | Folder exposed to the editor |
| `EDITHA_DATA_DIR` | `/data` | Private app data (backups in `backups/`) |
| `EDITHA_HOST` | `0.0.0.0` | Address the server listens on |
| `EDITHA_PORT` | `8099` | Ingress port (must match `ingress_port`) |
| `EDITHA_ALLOWED_IPS` | `172.30.32.2` | Accepted addresses, comma-separated |
| `EDITHA_MAX_FILE_SIZE` | `5242880` | Maximum bytes of a file opened or saved |
| `EDITHA_MAX_TRANSFER` | `52428800` | Maximum bytes for uploads and downloads (ZIPs included) |
| `EDITHA_BACKUP_KEEP` | `10` | Versions kept per file |
| `EDITHA_LOG_LEVEL` | `info` | Log level |
| `EDITHA_WEB_DIR` | `/app/web` | Built web interface |
| `EDITHA_HA_URL` | `http://supervisor/core/api` | Home Assistant Core API |
| `EDITHA_HA_TOKEN` | `SUPERVISOR_TOKEN` | Token for the Core API (provided by the Supervisor) |

### API

All paths are relative to `/config`, in POSIX form (`packages/luci.yaml`); `""` is the root.
Errors have the form `{ "error": { "code": "...", "message": "...", "details": { ... } } }`.

Requests are validated with Ajv without type coercion (`coerceTypes: false`) and without
unknown fields: in the query, booleans are the strings `'true'` / `'false'` (`overwrite`,
`noBackup`, `fresh`).

| Method and path | Body / query | Response |
| --- | --- | --- |
| `GET /api/health` | | `{ status: "ok", build }`: `build` identifies the installed web interface (`"dev"` without a build); the page compares it to notice an update |
| `GET /api/tree` | `?path=` | `{ path, entries: Entry[] }`, folders first |
| `GET /api/file` | `?path=` | `{ path, content, etag, size, mtime, readOnly }` |
| `PUT /api/file` | `{ path, content, etag }` | `{ path, etag, size, mtime }`; 409 `conflict` (`details: { path, etag }`, current etag or `null`) if the file has changed, even during the save itself (checked again just before the rename); 413 above `EDITHA_MAX_FILE_SIZE`; 400 `invalid_request` if `content` is not well-formed UTF-16 (lone surrogates) |
| `POST /api/file` | `{ path, type: "file" \| "directory", content? }` | 201 with the created `Entry` |
| `POST /api/rename` | `{ from, to }` | `Entry` at the new location; the history follows the file or folder |
| `DELETE /api/file` | `?path=&noBackup=true\|false` | `{ path, backup }` with the id of the copy. A file or folder above `EDITHA_MAX_TRANSFER` gets no copy: 409 `no_backup` (`details: { path, size, limit }`; for folders `size` is a minimum) and nothing is deleted, unless `noBackup=true` (then `backup: null`). Links are deleted without a copy (`backup: null`) and without confirmation |
| `GET /api/download` | `?path=` | The file, or the folder as a ZIP (`Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`); 413 `too_large` above `EDITHA_MAX_TRANSFER`. In the ZIP, `\` and `:` in names become `_`; when downloading the root, `.storage`, `.cloud`, `deps`, `tts` and `.git` are left out |
| `GET /api/preview` | `?path=` | Image or PDF with its own Content-Type, `inline` (FS-10); 415 `not_previewable` for other files, 413 `too_large` above `EDITHA_MAX_TRANSFER`. SVGs get a `sandbox` CSP. |
| `POST /api/upload` | `?dir=&name=&overwrite=true\|false&noBackup=true\|false`, body `application/octet-stream` | 201 with `Entry & { backup }`: `backup` is the id of the copy of the replaced file, `null` for a new file or with `noBackup`; 409 `already_exists` without `overwrite`; 409 `no_backup` (`details: { path, size, limit }`) if the file to replace exceeds `EDITHA_MAX_TRANSFER` and `noBackup=true` is missing; 413 if the body exceeds `EDITHA_MAX_TRANSFER` (before touching the disk) |
| `GET /api/versions` | `?path=` | `{ path, versions: Version[] }`, newest first |
| `GET /api/history/usage` | | `{ totalBytes, versions, fileCount, keep, files: [{ path, bytes, versions, oldest, newest, exists }] }`: disk space used by the history (allocated blocks, indexes and leftovers included), at most 200 files, largest first; `path` null if the index is unreadable |
| `POST /api/history/prune` | `{ olderThanDays?: 1…36500, before?: ISO, all?: true, dryRun }` | `{ versions, bytes, files: [{ path, versions, bytes, emptied }], failed: [path], leftovers: { count, bytes }, before }`: with `all` it deletes everything up to `before` (or up to now), leftovers included (folders without versions, interrupted writes; only folders with a sha256 name); deletes (or with `dryRun` counts) the versions older than the cutoff; with `olderThanDays` the server computes the cutoff, a future date gives 400; `before` in the response must be sent back unchanged to delete exactly what the preview showed. Never the files in /config; the log lists up to 50 paths |

Error codes: `invalid_request` / `not_a_file` / `not_a_directory` (400),
`forbidden_path` / `read_only` / `forbidden_origin` (403), `not_found` (404),
`already_exists` / `conflict` / `config_invalid` (409), `no_backup` (409, no copy possible:
retry with `noBackup=true` after confirmation), `busy` (409, path in use or changed during the
operation, e.g. a folder filled while it is being deleted: retry), `cross_device` (409, moving
between different disks is not supported), `too_large` (413), `binary` / `not_previewable`
(415), `internal` (500, details only in the log), `io_error` (500, disk read/write error),
`ha_error` (502), `ha_unavailable` (503), `no_space` (507, disk full).

Backup copies (BK-1): each version is written under a temporary name, synced to disk and then
renamed, before the operation that requires it. Ids always increase (even if the clock goes
backwards) and the version just created is never discarded. Content identical to the latest
version does not create a new version: the existing id is returned.

## Web interface (`editha/web`)

[Lit](https://lit.dev) for components, [CodeMirror 6](https://codemirror.net) for the editor,
bundled with `esbuild-wasm` (WebAssembly: no native binary, same result on every
architecture). Colors are CSS variables in `public/index.html`: switching theme only changes
the `data-theme` attribute.

```sh
cd editha/web
npm ci
npm run typecheck
npm test          # unit tests (in test/: connection, editor-review, i18n, jinja-template, keys, outline, snippets, tabs, yaml-lint)
npm run build     # produces dist/ (with .gz and .br versions)
npm run watch     # rebuilds on every change
npm run test:e2e  # builds server and web interface and runs the browser tests
```

The browser tests need Chromium (`npx playwright install chromium`). Each test maps to a
requirement or to a File Editor Plus issue (`e2e/editha.spec.ts`).

### Structure of the main component

`src/components/app.ts` (`<editha-app>`) keeps the element itself: reactive state, lifecycle,
styles, `render()`, tab handling, status and toolbar refresh, and the shared helpers. Each feature
lives in a controller under `src/app/` that receives the app instance (`new XController(this)`)
and imports its type only (`import type`), so there are no circular imports at runtime:

- `drafts.ts`: drafts of unsaved changes (ED-14), including drafts left by other windows and the
  keep-alive; `session.ts`: session restore and save; `save.ts`: saving, conflicts, reload from
  disk.
- `file-ops.ts`: the file tree (create, rename, move, delete, duplicate, upload, download, ZIP,
  context menu); `history.ts`: file history and its space; `git.ts`: Git panel glue (diffs,
  restore from a commit).
- `ha.ts`: Home Assistant menu (check, reload, restart) and template preview (HA-7);
  `snippets.ts`: Insert panel and user snippets; `search.ts`: search and replace in all files,
  `!include`/`!secret` links.
- `split.ts`: split view; `outline.ts`: file outline; `server.ts`: offline and "updated" banner;
  `keyboard.ts`: toolbar actions, shortcuts and leaving the page.

Reactive state stays on the app (setting it from a controller goes through `this.app`), and
`disconnectedCallback` stops the controllers' timers and listeners.

To try the web interface by hand: `npm run build`, then start the server as above with
`EDITHA_WEB_DIR=../web/dist` and open `http://127.0.0.1:8099/`.

### APIs used by the web interface, besides the file APIs

| Method and path | Body | Response |
| --- | --- | --- |
| `GET /api/settings` | | Settings (theme, language, tree, line wrapping, font, system folders, outline) |
| `POST /api/settings` | fields to change | Updated settings (POST rather than PATCH: some reverse proxies block PATCH) |
| `GET /api/snippets` / `PUT /api/snippets` | `{ snippets: [{ id, name, body }] }` | Personal snippets |
| `POST /api/search` | `{ query, regex?, caseSensitive?, wholeWord? }` | `{ results: [{ path, matches: [{ line, column, length, text, offset }], total }], files, matches, truncated }`; `offset` is the position of `text` in the line (long lines are shortened). `matches` is limited (200 per file, only within the first 10,000 characters of a line); `total` is the unlimited number of matches that `POST /api/replace` would change in the file (to show in the confirmation). The response's overall `matches` remains the sum of the `matches` shown. Skips top-level system folders (`.storage`, `.cloud`, `.git` at any depth), links, files above `EDITHA_MAX_FILE_SIZE`, binaries and secret files (see below) |
| `POST /api/replace` | `{ paths (at most 2500), query, replacement, regex?, caseSensitive?, wholeWord? }` | `{ files: [{ path, count, etag }], skipped: [{ path, reason }] }`; `files` lists only the changed files (a file where the replacement changes nothing, e.g. `a` → `a`, appears in neither `files` nor `skipped`). `reason` is an error code (`read_only` for secret files, `conflict`, `too_large`, `not_found`…), `binary` (not UTF-8 text), `encoding` (the result would split a character, e.g. a regex without `u` on half of an emoji) or `error` |
| `GET /api/folders` | | `{ folders }`: writable folders, destinations of "Move to…" (the move uses `POST /api/rename`) |
| `GET /api/secrets?path=` | | `{ secrets: [{ key, path, line }] }`: !secret keys visible from the file, never the values |
| `GET /api/drafts` | | `{ drafts: [{ path, content, etag, savedAt, client?, live, idleMs }] }`: unsaved changes; `live` = the window that wrote them has checked in within the last 90 s |
| `PUT /api/draft` / `DELETE /api/draft?path=&client=` | `{ path, content, etag, client? }` | Keeps or discards a file's draft for one window (`client`, kept in sessionStorage); without `client`, the draft from previous versions. Never for `secrets.yaml` and copies (403; `GET /api/drafts` and `claim` ignore them) |
| `POST /api/draft/claim` | `{ path, from?, client }` | Takes over for `client` the draft written by `from` (absent: previous version), in a single operation: `{ claimed: true, draft }`, or `{ claimed: false }` if another window has already taken or discarded it |
| `POST /api/drafts/alive` | `{ client, closing? }` | The window is open (every 20 s and when it comes back to the foreground) or is closing (`pagehide`) |
| `GET /api/version?path=&id=` | | Text of a stored version |
| `POST /api/restore` | `{ path, id }` | `{ path, etag, size, mtime }`: restores a version, also of a deleted file (recreated with the copy's permissions; the replaced one stays in the history). 413 if the version or the current file exceed `EDITHA_MAX_TRANSFER`; 409 `conflict` if the file changes during the restore; folder versions give `not_a_file` |
| `POST /api/copy` | `{ from, to }` | 201 with the `Entry`: duplicates a file or folder (links copied as links, up to `EDITHA_MAX_TRANSFER`); the destination must not exist. A failed copy does not leave the destination half-written. The web interface duplicates files only |
| `GET /api/ha/status` | | `{ available }` |
| `GET /api/ha/entities` / `GET /api/ha/services` | `?fresh=true` to skip the cache | HA entities and actions |
| `GET /api/git/info` | | `{ available, version, repo: 'none' \| 'ready' \| 'broken', branch, head: { hash, subject, date } \| null, gitignore }`: GIT-1, repository in /config (not in parent folders) |
| `POST /api/git/init` | | `{ info, gitignoreCreated }`: `git init` (branch main) and a basic `.gitignore` if missing; 409 if `.git` already exists |
| `GET /api/git/status` | | `{ files: [{ path, status: 'modified' \| 'added' \| 'deleted' \| 'conflict', blocked: 'secret' \| 'sensitive' \| 'filter' \| 'conflict' \| 'nested' \| null, folder?: { files, excluded, list }, untracked }], truncated, merging }`: GIT-2, new folders on one line (`-unormal`), at most 2000 lines; `list` is the first 200 files that can go into the commit, to pick one by one; committing a folder includes its files except the blocked ones |
| `POST /api/git/commit` | `{ message, paths: [...] }` or `{ message, all: true }`, plus `folders?: { [folder]: number }` | `{ hash, subject, files, skipped }`: GIT-4, only the given files (`--only`), also single files inside a new folder (only those that could go in with the folder); blocked files (`blocked`): 403 if given, skipped with `all`; 409 during a merge; paths passed via stdin; author EDITHA if the repository has none; `folders` is the number of files seen for each new folder: if it has changed in the meantime, 409 `conflict`. `.gitattributes` filters, hooks, signing and external programs always off |
| `GET /api/git/head?path=` | | `{ path, content \| null }`: GIT-3, the file in the latest commit (`cat-file blob`, without filters); 403 for secrets and internal data |
| `GET /api/git/show?path=&rev=` | | as above for any commit (`rev`: hexadecimal hash) |
| `GET /api/git/log?skip=` | | `{ commits: [{ hash, author, date, subject }], more }`: GIT-5, 50 per page |
| `GET /api/git/commit-files?rev=` | | `{ hash, files: [{ path, status, blocked }] }`: files touched (`diff-tree`, first parent) |
| `POST /api/git/ignore` | `{ path }` | `{ ok }`: adds `/<path>` (special characters escaped) to `.gitignore`, created if missing; never on a `.gitignore` that is not a regular file |
| `GET /api/git/ignored` | | `{ entries: [{ line, path }] }`: `.gitignore` lines starting with `/` (exact paths, as Exclude writes them) |
| `POST /api/git/unignore` | `{ line }` | `{ ok, stillIgnored }`: removes exactly that line (and the Exclude heading if it is left empty); `stillIgnored` is true if another `.gitignore` rule still excludes the same path |
| `POST /api/git/gitignore` | | `{ info, created }`: basic `.gitignore`, never over an existing one |
| `GET /api/download/excluded?path=` | | `{ excluded: [path] }`: secrets.yaml and copies that the ZIP of that folder will leave out (SEC-7), at most 100 |
| `POST /api/ha/check` | | `{ valid, errors, warnings }` |
| `POST /api/ha/template` | `{ template, path? }` | `{ ok: true, result }` or `{ ok: false, kind: 'syntax' \| 'render', message }`: HA-7, renders the template with Core's `POST /api/template`. Requires `{{`, `{%` or `{#`; 403 for secrets.yaml and copies (also through a link); HA does not report the error line |
| `POST /api/ha/reload` / `POST /api/ha/restart` | | `{ ok, warnings }`: checks and then reloads / restarts; 409 `config_invalid` with the errors |
| `GET /api/session` | | `{ tabs, active, side? }` |
| `PUT /api/session` | `{ tabs: [{ path, anchor, head, scrollTop }], active, side? }` | The saved session; `side` is the file in the right column of the split view |

### Search rule and secret files

The expression is built with `buildSearchRegExp` (`editha/server/src/fs/search.ts`), which the
web interface mirrors:

- plain text: the query with `.*+?^${}()|[]\` prefixed by `\`; with `regex`, the query as is;
- flag `g`, plus `i` without `caseSensitive`, plus `u` if the expression is valid with `u`;
  otherwise it is used without `u` (e.g. lone `\-` or `{`);
- `wholeWord`: with `u` `(?<![\p{L}\p{N}_])(?:…)(?![\p{L}\p{N}_])` (accented letters included),
  without `u` `(?<![\w])(?:…)(?![\w])` (ASCII only);
- search and replace work line by line (without the trailing `\r`) and ignore empty matches.

Secret files (SEC-7, never in search, replace, folder ZIPs, Git commits or template preview):
`isSecretsFile` in `editha/server/src/fs/search.ts`, on the file name, true if it matches one
of these two expressions:

- `/secrets[^/]*\.ya?ml/i`: `secrets` anywhere in the name, then `.yaml`/`.yml` anywhere:
  `secrets.yaml`, `secrets.yml`, `secrets_copia.yaml.bak`, `secrets.yaml_copy.bak`,
  `secrets.yaml~`, `.secrets.yaml.swp`, `old_secrets.yaml`, `20240101_secrets.yaml`,
  `secretsold.yaml`, `secrets_esphome.yaml` (the same rule as the Git panel's sensitive data);
- `/^[.#~]?secret(?:[._~ -]?(?:\d+|bak|backup|old|orig|copy|copia|new|\(\d+\)))*\.ya?ml/i`: the
  singular `secret` only as a copy: `secret.yaml`, `secret_old.yaml`, `secret (2).yaml`.

`secretary.yaml`, `secret_sensors.yaml` and `mysecret.yaml` are not secrets.

## Image

`editha/Dockerfile` uses the HA base image set in `build.yaml`. CI
(`.github/workflows/editha.yaml`) runs the tests, builds the image for `amd64` and `aarch64`
(on a native ARM runner, no emulation) and checks that the server responds.

Home Assistant does not build the app on the device: `image:` in `config.yaml` points to the
ready-made images `ghcr.io/trizompa/{arch}-addon-editha`, published by
`.github/workflows/publish.yaml` (run by hand, see RELEASING.md). To try a local build in Home
Assistant (development only), remove the `image:` line from a local copy of the app.

Local build:

```sh
docker build -t editha editha
```
