# EDITHA – requirements

Every Day I Tweak HA. A Home Assistant app (formerly add-on) that provides an
editor/IDE for the files in `/config`.

Status: **agreed** (October 2026). Later changes go through this document.

## Principles

- Written from scratch. File Editor Plus (FEP) is only a reference for features:
  it has no license, so no code, assets or text are copied.
- Editor based on CodeMirror 6: undo/redo, Tab, indentation, guides, highlighting and
  search come from its extensions, not from hand-made implementations.
- Backend reachable only through Ingress and confined to `/config`.
- Small modules with one responsibility each; logic that touches the filesystem or the
  HA APIs lives in the backend and has tests.

## Priorities

| Level | Meaning |
| --- | --- |
| **P0** | Essential for the first usable version (MVP). |
| **P1** | Required for 1.0. |
| **P2** | Useful, to be planned after 1.0. |
| **—** | Out of scope (with a reason). |

The IDs (`SEC-1`, `ED-3`, …) are for citing requirements in issues and commits.

---

## 1. Security and backend

| ID | Requirement | Pr. |
| --- | --- | --- |
| SEC-1 | No exposed port: the server listens only on the Ingress port and accepts requests only from the Supervisor's Ingress proxy (`172.30.32.2`); requests the browser marks as coming from another site (`Sec-Fetch-Site: cross-site`) are rejected. | P0 |
| SEC-2 | Every received path is resolved (including `realpath` for symlinks) and rejected if it leaves `/config`. No `..`, no outside absolute paths, no null bytes. | P0 |
| SEC-3 | Atomic write: temporary file in the same folder + `rename`, preserving permissions. An interrupted save never leaves a truncated file. | P0 |
| SEC-4 | Conflict detection: the client sends the etag (SHA-256 of the content read); if the file has changed on disk in the meantime the backend responds 409 and the UI asks what to do (cancel / reload from disk / overwrite; when overwriting, the version on disk goes into the history). | P0 |
| SEC-5 | Limits: maximum size that can be opened in the editor (configurable), binary file detection (opened read-only or download-only). | P0 |
| SEC-6 | The Supervisor token never reaches the browser; calls to Core go through the backend. | P0 |
| SEC-7 | `secrets.yaml`: editable, but the values never end up in the logs or in autocompletion responses (keys only). `secrets.yaml` and its copies (see `isSecretsFile` in `server/src/fs/search.ts`: names that contain `secrets` followed, anywhere, by `.yaml`/`.yml`, such as `secrets_copia.yaml.bak`, `secrets.yaml~` or `old_secrets.yaml`; the singular `secret` only with a copy suffix, such as `secret.yaml` or `secret_old.yaml`; also when reached through a link) are excluded from search and replace, never in folder ZIPs (0.34.0), never in Git commits, no template preview. | P0 |
| SEC-8 | Sensitive folders (`.storage`, `.cloud`, `deps`, `tts`, `.git`) hidden in the tree by default, visible with a button (choice remembered) and always read-only; an explicit write unlock is to be evaluated. | P1 |
| SEC-9 | Backend logs without file content. | P0 |

## 2. File explorer

| ID | Requirement | Pr. |
| --- | --- | --- |
| FS-1 | Tree of `/config` with lazy loading of folders and folders → files ordering; the tree scrolls independently of the editor even with many files, with mouse and keyboard (FEP #4). | P0 |
| FS-2 | Create file and folder from the buttons above the tree and from the context menu (right click). The destination is the selected folder, even if empty (or the folder of the selected file); the tree refreshes and the new file opens (FEP #11, #12). | P0 |
| FS-3 | **Rename** files and folders from the context menu and with F2 in the tree, updating tabs open on the old path; the history (BK-1) follows the file (FEP #18). | P0 |
| FS-4 | Delete with confirmation (context menu or Del in the tree); the deleted file goes into Editha's backups (BK-1), it does not vanish. Above 50 MB (transfer limit) it is deleted without a copy, with a warning. | P0 |
| FS-5 | Move with the "Move to…" context menu item (no drag and drop: too easy to get wrong), updating open tabs. | P1 |
| FS-6 | Upload from the PC (also by dragging files) and download to the PC; download of a folder as a zip. 50 MB limit per transfer (`EDITHA_MAX_TRANSFER`). | P1 |
| FS-7 | Name filter in the tree; tree refresh when files change on disk. | P1 |
| FS-8 | Duplicate a file (files only) from the context menu, with a proposed name to confirm (`name_copy.ext`, `_copia` in Italian). YAML copies end in `.bak`, so HA does not load them; a `.yaml` name must be confirmed. | P1 |
| FS-9 | Configurable exclusion list (glob patterns). | P2 |
| FS-10 | Preview of images (PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, SVG) and PDFs instead of the editor, with dimensions and actual size; SVGs cannot run scripts. | P1 |

## 3. Editor

| ID | Requirement | Pr. |
| --- | --- | --- |
| ED-1 | CodeMirror 6 with: undo/redo that also undoes indentation done with Tab, without errors; Tab/Shift-Tab on a selection indents the block (never deletes it); automatic indentation, indentation guides, line numbers, bracket matching, folding (FEP #8, #9, #14). | P0 |
| ED-2 | Modes for YAML, JSON, Python, JavaScript, TypeScript, CSS, Markdown, Jinja; plain text for the rest. | P0 |
| ED-3 | Multiple tabs: unsaved changes indicator, state (undo, cursor, scroll) kept per tab, closing the file with a button and a shortcut. The active and inactive tabs are clearly distinguishable in both themes, with the same visual language as the toolbar (FEP #15). | P0 |
| ED-4 | **Closing the active tab activates the adjacent tab and the editor shows its content**; closing the last one shows the empty state. "Save" always writes the active tab's content to its own file, never another tab's (FEP #19). Covered by e2e tests. | P0 |
| ED-5 | Save with Ctrl/Cmd+S and a button; "Save all". | P0 |
| ED-6 | Warning before closing a tab or the page with unsaved changes (FEP #10). | P0 |
| ED-7 | Find/replace in the file (CM6 `search` extension). | P0 |
| ED-8 | Theme Automatic (follows HA) / Light / Dark; the choice is remembered when leaving and re-entering the app (CFG-1, FEP #6). In both themes selected text stays readable, without overlapping characters, on Chrome, Firefox, Safari and the HA app (FEP #7). | P0 |
| ED-9 | Warning when the open file changes on disk (see SEC-4), with reload. | P1 |
| ED-10 | Line wrapping, font size, spaces for indentation: per-user settings. | P1 |
| ED-11 | Leaving the app (or after a restart) and coming back restores the open tabs, with the same active tab and cursor position (FEP #13). | P0 |
| ED-14 | Unsaved changes survive closing the page as a draft, which can be recovered or discarded on reopening (FEP #13). | P1 |
| ED-15 | The editor fills all the available height and scrolls to the last line of any file (FEP #15). | P0 |
| ED-16 | Browser spell check, autocorrect and translation turned off in the editor: the only underlines are the validator's (FEP #5). | P0 |
| ED-12 | Command palette and shortcuts listed in a help screen. | P2 |
| ED-13 | Minimap. | P2 |
| ED-17 | Split view in two columns: two files (or two places in the same file) side by side. | P1 |
| ED-18 | Outline of the YAML file next to the editor (entries by alias: automations, scripts, sections, helpers), with jump to line and active entry; it can be turned on and off and the choice is kept. | P1 |

## 4. YAML and Home Assistant

| ID | Requirement | Pr. |
| --- | --- | --- |
| HA-1 | Real-time YAML validation (syntax) that recognizes HA tags: `!include`, `!include_dir_*`, `!secret`, `!input`, `!env_var`. Errors underlined at the exact spot (line and column) with a message; no reports on correct code; the underline updates/disappears while fixing (FEP #5). | P0 |
| HA-2 | Autocompletion of `entity_id` from Core states, with name and state in the suggestion. | P0 |
| HA-3 | Autocompletion of services/actions (`domain.service`). | P1 |
| HA-4 | Autocompletion of `!secret` keys from `secrets.yaml`. | P1 |
| HA-5 | Ctrl/Cmd+click on `!include path` opens the included file. | P1 |
| HA-6 | Hover on an `entity_id`: current state and attributes. | P2 |
| HA-7 | Jinja template preview through Core's rendering API. | P2 |
| HA-8 | Entity/service cache refreshed on request and periodically (or via WebSocket `state_changed`). | P1 |
| HA-9 | Check with concrete explanations (lines involved, expected indentation) and warnings for typical HA mistakes that are still valid YAML: unquoted `on`/`off`/`yes`/`no`, `key:value` without a space, odd indentation. Also explained: unquoted `{{ }}` templates (read as a key), a key that is a list or a `{ }` block, `*name` alias without an anchor, repeated keys, missing colon between key and value. List of problems with line and link. | P1 |
| HA-10 | Autocompletion of Material Design icons after `mdi:`, with preview. | P1 |
| HA-11 | Warning (not error) for entity ids after `entity_id:`, `entity:`, `entities:` (also comma-separated, lists, scene maps, `include_/exclude_entities`) that Home Assistant does not know; the closest entity of the same domain is suggested with a one-click fix. No check without the entity list; templates and tagged values are skipped. | P1 |

## 5. Home Assistant actions

| ID | Requirement | Pr. |
| --- | --- | --- |
| ACT-1 | Configuration check with a readable result (errors with file and line when HA provides them). | P0 |
| ACT-2 | Reload of the whole YAML configuration (`homeassistant.reload_all`), preceded by ACT-1: if the check fails there is no reload. The reload takes effect like its equivalent in Developer tools, and the result shown is the actual one returned by HA, not a blanket "started" (FEP #16). A per-domain reload is not needed (removed in 0.13.0). | P2 |
| ACT-3 | Suggestion of the right reload based on the saved file (e.g. `automations.yaml` → `automation.reload`). Not needed for now (user's decision, 0.34.0). | P2 |
| ACT-4 | HA restart with confirmation, always preceded by ACT-1: if the check fails the restart is blocked. | P1 |
| ACT-5 | Core log view (last lines, filter). | P2 |

## 6. Backup, compare and restore

| ID | Requirement | Pr. |
| --- | --- | --- |
| BK-1 | Before every save, replace (SR-3), restore, delete and overwriting upload, Editha keeps the previous version of the file (delete and upload only up to 50 MB). Rename and move carry the history along, without creating a version. A deleted file is recovered by recreating it at the same path and opening its history; deleted folders cannot be restored from the web interface. | P0 |
| BK-2 | List of a file's versions (date, size). | P1 |
| BK-3 | Side-by-side comparison version ↔ current (CM6 merge view), also for the SEC-4 conflict. | P1 |
| BK-4 | Restore of a version (which itself creates a version, so it can be undone). | P1 |
| BK-5 | Retention policy: 10 versions per file (configurable with `EDITHA_BACKUP_KEEP`). | P1 |
| BK-6 | Comparison between any two files. | P2 |
| BK-7 | History maintenance: space used (in total and per file), deletion of versions older than a date, full deletion; always with confirmation, only the copies, never the files in /config. | P2 |
| BK-8 | Full HA backups through the Supervisor (create/list). | P2 |

## 6b. Local Git

Only the repository in `/config`, on the device: no network commands (no push, pull or fetch).

| ID | Requirement | Pr. |
| --- | --- | --- |
| GIT-1 | Initialization of a repository in `/config` (branch `main`) with a basic `.gitignore` (secrets, HA internal data, databases, logs, temporary files); an existing repository or `.gitignore` is used as is. | P2 |
| GIT-2 | File status (modified, new, deleted), computed on request; a new folder is a single line, which can be opened to see and pick its files. | P2 |
| GIT-3 | Differences of a file against the latest commit, in the compare view. | P2 |
| GIT-4 | Commit with a message, of all files or the chosen ones (also single files inside a new folder); secrets.yaml and copies always refused. | P2 |
| GIT-5 | List of commits; for each one, the files touched. | P2 |
| GIT-6 | Restore of a file from a commit, with confirmation, through EDITHA's save (so it is also in its history). | P2 |

## 7. Search

| ID | Requirement | Pr. |
| --- | --- | --- |
| SR-1 | Text search across all files (respecting exclusions and limits), results clickable to the line. | P1 |
| SR-2 | Regular expressions and case sensitivity. | P1 |
| SR-3 | Replace in multiple files (with preview and BK-1 backup). | P2 |
| SR-4 | "Find references" of an `entity_id` across the whole configuration. | P2 |

## 8. Settings

| ID | Requirement | Pr. |
| --- | --- | --- |
| CFG-1 | Editha's settings have a single source (backend, in `/data`), apply immediately without reloading the page and survive an app restart. | P0 |
| CFG-2 | The app options in the HA panel are limited to those needed before startup (e.g. log level); the rest is in the UI settings. | P1 |

## 9. Web interface

| ID | Requirement | Pr. |
| --- | --- | --- |
| UI-1 | Layout: tree on the left (resizable and collapsible), tabs and editor in the center, status bar (path, cursor position, validation result). | P0 |
| UI-2 | Usable from tablets and from the HA mobile app (tree as a slide-out panel). | P1 |
| UI-3 | Interface in Italian and English, with a selector; "Automatic" follows the browser language. | P1 |
| UI-4 | Non-blocking notifications for results (saved, check ok/failed, reload done). | P0 |
| UI-5 | Basic accessibility: keyboard navigation in the tree and tabs. | P2 |
| UI-6 | The toolbar always acts on the active tab; buttons have a consistent state (e.g. "Save" disabled if there are no changes) and the same active/inactive style as the tabs (FEP #15). | P0 |
| UI-8 | "About" dialog: author, repository, version, license, credits. | P2 |
| UI-7 | "Copy all" in the toolbar or in the editor context menu (FEP #15). | P2 |

## 10. Engineering

| ID | Requirement | Pr. |
| --- | --- | --- |
| ENG-1 | Small, separate modules (see the proposed structure below); no "do-everything" file. | P0 |
| ENG-2 | Backend unit tests, in particular path confinement (SEC-2) and atomic write (SEC-3). | P0 |
| ENG-3 | e2e tests (Playwright) of the main flows, including ED-4. | P1 |
| ENG-4 | CI on GitHub Actions: lint, tests, image build for `amd64` and `aarch64`. | P0 |
| ENG-7 | Updating the app must not be able to fail at build time on the device: the frontend is built in an architecture-independent stage (or in CI) and the final image contains only already built files; no native dependencies tied to musl/glibc in the frontend. Verified on `aarch64` before every release (FEP #17). | P0 |
| ENG-5 | Semantic versioning, `CHANGELOG.md` updated at every release. | P0 |
| ENG-6 | Lightweight image based on HA base images; frontend assets built at build time, no downloads at runtime. | P0 |

## Out of scope (for now)

- **Terminal**: the SSH/Terminal app already exists; adding one would greatly widen the attack surface.
- **Remote Git** (push, pull, GitHub/Forgejo): possibly after local Git (GIT-1…6).
- **Access outside `/config`** (`/share`, `/media`, `/addons`, `/ssl`): possibly as a future option, one folder at a time.

---

## Repository structure

```
repository.yaml          collection metadata
README.md, CONTRIBUTING.md, SECURITY.md
LICENSE                  MIT
.github/
  workflows/             tests, browser tests and build for amd64/aarch64 (ENG-3, ENG-4); release
  ISSUE_TEMPLATE/        templates for bug reports and proposals
docs/
  REQUIREMENTS.md        this document
  DEVELOPMENT.md         how to try the code, server API
  RELEASING.md           how to publish a version
  images/                documentation images
editha/
  config.yaml            app manifest (ingress, /config, homeassistant_api)
  build.yaml, Dockerfile image: server and web interface build + Node.js runtime
  icon.png, logo.png
  README.md, DOCS.md, DOCS.it.md, CHANGELOG.md, CHANGELOG.it.md
  server/
    src/
      main.ts, app.ts    startup and composition
      config.ts          environment variables
      errors.ts          errors with a stable code
      security/          Ingress filter (SEC-1)
      fs/                paths (SEC-2), atomic write (SEC-3), files (FS-*), search (SR-*), zip, preview
      git/               local Git in /config (GIT-*)
      backups/           file versions (BK-*)
      ha/                calls to Core through the Supervisor (HA-2, ACT-*)
      state/             settings (CFG-1), session (ED-11), snippets and drafts (ED-14) in /data
      routes/            one file per endpoint group, built web interface
    test/                server tests (node:test)
  web/
    public/index.html    page and theme colors (CSS variables)
    build.mjs            bundle with esbuild-wasm, no native binaries
    playwright.config.ts
    scripts/             documentation images
    src/
      api/               client and types shared with the server
      state/             tabs (ED-3, ED-4), paths, HA data, preview: logic without DOM
      editor/            CodeMirror setup, theme, languages, YAML validator, completions, links, outline
      app/               controllers of the main component (drafts, file operations, Git, HA, history…)
      components/        app, toolbar, tree, tabs, editor, panels, status bar, dialogs, menus, notifications
      i18n/              interface in Italian and English (UI-3)
      ui/                shared icons and styles
    test/                unit tests
    e2e/                 browser tests (Playwright), one for each FEP issue
```

---

## Progress

| Version | Requirements covered |
| --- | --- |
| 0.40.0 | HA-11: unknown entity warning with suggested fix. |
| 0.39.1 | "App" instead of "add-on" everywhere (Home Assistant 2026.2 wording); old menu path kept in the installation steps. |
| 0.39.0 | Ready-made images on GHCR for `amd64` and `aarch64` (`image:` in `config.yaml`, *Publish images* workflow); CI builds aarch64 on a native ARM runner; documentation images with absolute links (Documentation tab). |
| 0.38.0 | History vs Git vs backup explained in the Git panel and guide; `app.ts` split into controllers under `src/app/` (no behaviour change); developer docs and CI names in English. |
| 0.37.0 | GIT-1: basic `.gitignore` in English, one line for all `*secrets*.yaml` copies; the exclusions heading written by earlier versions (in Italian) is still valid. |
| 0.36.0 | Final review before 1.0: broader SEC-7 (every `*secrets*.yaml`, no drafts), SEC-1 (requests from other sites rejected), ZIP without nested copies of `.storage`/`.cloud`, replace up to 2500 files, BK (histories merged on rename), restart reported correctly, web interface fixes, EDITHA name everywhere, CHANGELOG in English (`CHANGELOG.it.md` in Italian). |
| 0.35.0 | GIT-2 and GIT-4: new folders can be opened, files chosen or excluded one by one (at most 200 per folder); toolbar buttons that only make sense with an open file (line wrap, outline, Insert) disabled without a file; English guide images visible. |
| 0.34.0 | SEC-7: secrets.yaml and copies never in folder ZIPs, with a warning; requirements reordered (BK-8 for Supervisor backups); documentation images updated. |
| 0.33.0 | Touch-ups: template preview removed from the Home Assistant menu; History button that closes on the second click; Git legend in a box, one item per line; welcome page and About more essential; motto in quotes. |
| 0.32.0 | GIT-2: Excluded section with «Include» (no more editing .gitignore by hand), legend for letters, checkmark and eye; comparison only if there is a commit to compare with. |
| 0.31.0 | GIT-2: new folders grouped on one line, «Exclude» (a line in .gitignore), warning at the first commit; opaque Git panel on phones. |
| 0.30.0 | GIT-3, GIT-5, GIT-6: differences against the latest commit, commit history with the files touched, comparison and restore of a file as it was in a commit (through EDITHA's save). Local Git complete. |
| 0.29.0 | GIT-2 and GIT-4: changes since the latest commit with checkboxes, commit of the chosen files with a message; secrets.yaml and copies never. |
| 0.28.0 | GIT-1: Git panel in the sidebar, initialization of the repository in /config with the basic .gitignore; git in the app image. |
| 0.27.1 | HA-7: the preview follows the cursor onto another template, without needing Alt+T. |
| 0.27.0 | HA-7 (2/2): toolbar button, automatic refresh while typing, Copy, warning for nonexistent entities, syntax error line found by EDITHA. |
| 0.26.0 | HA-7 (1/2): preview of the selected template or the one under the cursor (Alt+T, Home Assistant menu), computed by Home Assistant, in a panel below the editor. |
| 0.25.0 | BK-7 (3/3): full deletion of the history («all» option), confirmed by typing CANCELLA (DELETE in English). |
| 0.24.0 | BK-7 (2/3): deletion of versions older than 7/30/90 days, one year or a date, with preview and confirmation. |
| 0.23.0 | BK-7 (1/3): space used by the history, from About and from the history; ED-14: recovered drafts claimed atomically (0.22.4). |
| 0.22.3 | ED-14: per-window drafts (multiple windows or devices do not discard or overwrite each other's drafts), open-window signal, offer of drafts from closed windows; Esc on the prompt really postpones (0.22.2). |
| 0.22.0 | Second review: BK-1 (no deletion without a copy unless confirmed, versions without duplicates, monotonic ids), SEC-3/SEC-4 (conflict also during the write), SEC-7 (secrets.yaml copies in every form), ED-14 (drafts retried, maximum wait, recreates a vanished file), CRLF preserved, HA-9 (invisible spaces, unknown tags, beginner mistakes), shortcuts by keyboard letter. |
| 0.21.0 | Code review: SEC-7 (secrets.yaml copies excluded from search and replace), HA-9 (unquoted templates, complex keys, aliases without an anchor), shortcuts by physical key (also on Mac), drafts that can no longer be saved discarded with a warning. |
| 0.20.2 | BK-2: the open history follows the file change. |
| 0.20.1 | FS-1: no arrow on empty folders. |
| 0.20.0 | ED-18: file outline. |
| 0.19.1 | FS-10: dedicated preview tab (one, reused), zoom shown, image centered at actual size. |
| 0.19.0 | FS-10: preview of images and PDFs. |
| 0.18.2 | Store description: "Smart file editor for Home Assistant". |
| 0.18.1 | New file/folder only above the tree (removed from the top bar). |
| 0.18.0 | User documentation (DOCS.md, DOCS.it.md) with images; GitHub files (CONTRIBUTING, SECURITY, templates, release); HA-9: «key value» without a colon explained. |
| 0.17.2 | On phones only the EDITHA name in the bar, without the logo. |
| 0.17.1 | EDITHA name in uppercase in the interface, motto "Every Day I Tweak HA"; removed the "File explorer" label above the tree. |
| 0.17.0 | Editing of personal snippets. |
| 0.16.0 | BK-6: comparison between any two files. Panel icon: mdi:pencil-circle-outline (0.16.1: mdi:pencil). |
| 0.15.0 | SR-3: replace in multiple files, with confirmation and history. |
| 0.14.0 | HA-10: MDI icon autocompletion with preview. |
| 0.13.2 | "Close the keyboard" button next to the cursor; secrets.yaml excluded from search. |
| 0.13.1 | Fixes from the general code review. |
| 0.13.0 | SR-1, SR-2 (search in all files, regex, case, whole word), SR-4 (where an entity is used). Per-domain ACT-2 removed from the list (not needed). |
| 0.12.0 | FS-5: "Move to…" from the context menu. |
| 0.11.0 | HA-4 (!secret keys), HA-5 (Ctrl+click on !include, !include_dir_…, !secret). |
| 0.10.0 | HA-9: explanations of indentation errors, warnings for typical HA mistakes, list of problems. |
| 0.9.0 | ED-17: split view in two columns; About dialog. |
| 0.8.1 | UI-2: no iOS rubber-band effect on the editor. |
| 0.8.0 | ED-14: drafts of unsaved changes, recoverable on reopening. |
| 0.7.1 | UI-2: button to close the keyboard on iPhone; safer FS-8 (YAML copies as .bak). |
| 0.7.0 | BK-2, BK-3, BK-4: history with compare and restore; BK-5: 10 versions per file; FS-8: duplicate; context menu with long press on phones. |
| 0.6.0 | FS-6: upload from the PC (button, menu, drag and drop) and download (file, folder as zip). |
| 0.5.0 | UI-3: interface in Italian and English with a selector (automatic from the browser). |
| 0.4.2 | Supervisor token fix with s6-overlay (HA-2, ACT-* in the real app); 13/14 px font; updates without a forced refresh. |
| 0.4.1 | Lost connection / app updated warning with page reload; retry of reads. |
| 0.4.0 | HA-2, HA-3 (entity and action autocompletion), ACT-1, ACT-2 (reload of all YAML), ACT-4, built-in and personal snippets; compact line number column. |
| 0.3.1 | Description: just "Easy Developer IDE for The HA". |
| 0.3.0 | New name: Editha (D10). |
| 0.2.2 | UI-2: compact line number column on phones, wrapped lines aligned to the indentation. |
| 0.2.1 | SEC-8: system folders hidden by default, button to show them. |
| 0.2.0 | Web interface: FS-1, FS-2, FS-3, FS-4, FS-7 (name filter), ED-1…ED-8, ED-10 (line wrapping only), ED-11, ED-15, ED-16, HA-1, CFG-1, UI-1, UI-2, UI-4, UI-5 (keyboard in the tree), UI-6, ENG-3. P0 still to do: HA-2 (entity autocompletion), ACT-1 (configuration check). |
| 0.1.0 | SEC-1, SEC-2, SEC-3, SEC-4, SEC-5, SEC-6 (no exposed token), SEC-9, ENG-1, ENG-2, ENG-4, ENG-6, ENG-7; server side: FS-2, FS-3, FS-4, BK-1, BK-2, BK-5 (fixed limit of 50 versions), SEC-8 (without unlock). |

---

## Decisions

| # | Decision | Reason |
| --- | --- | --- |
| D1 | Backend in **TypeScript** (Node.js). | One language for backend and frontend, shared API types, `yaml` library with support for HA tags. |
| D2 | Frontend with **Lit**. | Small, lightweight components, same technology as the HA frontend; CodeMirror 6 integrates without adapters. |
| D3 | File versions in **`/data/backups`**. | Outside `/config`, included in the app backup. |
| D4 | Priority to **single-file versions** (BK-1…5); full Supervisor backups at P2 (BK-8). | |
| D5 | The repository becomes **public at the first release**. | The Supervisor must be able to clone it without credentials. |
| D7 | **`amd64`** and **`aarch64`** architectures. | HA has deprecated 32-bit architectures. |
| D9 | `.storage` and similar **hidden by default** (Trizompa's proposal after the first trial), visible on request and **read-only** (SEC-8). | |
| D10 | Final name **EDITHA**, written in uppercase in the interface and documentation, with the motto "Every Day I Tweak HA" (since 0.17.1, replacing "Easy Developer IDE for The HA"); slug `editha`. | Trizompa's choice after the first installation. |
| D6 | **MIT** license. | Simple and widespread among HA apps. |
| D8 | FEP issues #4–#19 are covered by the requirements (see the table below). | |

### File Editor Plus issues → requirements

Reference only for expected behavior and problems found; no FEP code.

| FEP | Problem | Requirement |
| --- | --- | --- |
| #4 | The file tree does not scroll, only two items are visible | FS-1 |
| #5 | Red underlines on correct code after a click (probably the browser spell check) | ED-16, HA-1 |
| #6 | The chosen theme goes back to "Auto" when leaving and re-entering | ED-8, CFG-1 |
| #7 | Selected text unreadable (overlapping characters), worse on Chrome | ED-8 |
| #8 | Tab on a selection deletes the text; then Ctrl+Z gives an error | ED-1 |
| #9 | Indentation guides are missing | ED-1 |
| #10 | No warning when closing a file with unsaved changes | ED-6 |
| #11 | "New file/folder" creates in the root ignoring the selected folder; impossible in empty folders | FS-2 |
| #12 | "New file/folder" missing from the context menu | FS-2 |
| #13 | Leaving the app loses the open tabs (HA's File Editor remembers the last file) | ED-11, ED-14 |
| #14 | Undo does not undo indentation done with Tab | ED-1 |
| #15 | Active/inactive tabs with colors opposite to the toolbar and hard to tell apart; lines past 40 not visible; "Copy all" requested | ED-3, UI-6, ED-15, UI-7 |
| #16 | "Reload YAML" says "started" but reloads nothing | ACT-2 |
| #17 | Update failed on `aarch64`: frontend build on the device without Rollup's native module for musl | ENG-7 |
| #18 | "Rename" missing for files and folders, both in the toolbar and in the context menu | FS-3 |
| #19 | After closing the active tab, the editor still shows the closed file; "Save" risks writing the wrong content | ED-4 |
