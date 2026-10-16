# EDITHA

*Every Day I Tweak HA*

![EDITHA on desktop and phone](https://raw.githubusercontent.com/Trizompa/ha-addons/main/docs/images/cover.png)

EDITHA is a file editor for your Home Assistant configuration. It runs as an add-on, opens from
the sidebar and works on a PC, a tablet or a phone. It knows Home Assistant: it explains YAML
errors in plain words, suggests your entities, actions and icons, and checks the configuration
before every restart. Every save keeps the previous version, so you can always go back.

*Documentazione in italiano: [DOCS.it.md](https://github.com/Trizompa/ha-addons/blob/main/editha/DOCS.it.md).*

## Contents

- [Installation](#installation)
- [The window at a glance](#the-window-at-a-glance)
- [Files and folders](#files-and-folders)
- [Editing](#editing)
- [Help with Home Assistant](#help-with-home-assistant)
- [Search and replace in all files](#search-and-replace-in-all-files)
- [History and comparison](#history-and-comparison)
- [Phone and tablet](#phone-and-tablet)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Safety and privacy](#safety-and-privacy)
- [Troubleshooting](#troubleshooting)

## Installation

1. Add the repository to Home Assistant with this button, or by hand under
   **Settings → Add-ons → Add-on store → ⋮ → Repositories** with the URL
   `https://github.com/Trizompa/ha-addons`.

   [![Add the repository to Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FTrizompa%2Fha-addons)

2. Open **EDITHA** in the store and press **Install**.
3. Press **Start**, then turn on **Show in sidebar**.
4. Open EDITHA from the sidebar (pencil icon).

There is nothing to configure. EDITHA has no options and opens no ports: it is reachable only
through Home Assistant (Ingress), with your Home Assistant login.

## The window at a glance

![Main window](https://raw.githubusercontent.com/Trizompa/ha-addons/main/docs/images/main-dark.png)

- **Toolbar** (top): file explorer, save and save all, undo and redo, find,
  file history, word wrap, split view, insert panel and the Home Assistant menu. On the right:
  language (Italian or English), theme (automatic, light, dark) and About.
- **File explorer** (left): the content of `/config`. Above it: search in all files, new file,
  new folder, system folders, upload, refresh and collapse all.
- **Tabs and editor** (centre): one tab per open file. A dot on a tab means unsaved changes.
- **Status bar** (bottom): file path, YAML check result, cursor position, encoding and language.

Open tabs, the active tab, the theme and the language are remembered when you leave EDITHA or
restart the add-on.

![Light theme](https://raw.githubusercontent.com/Trizompa/ha-addons/main/docs/images/main-light.png)

## Files and folders

Right-click a file or folder in the explorer (long press on a phone) for its menu:

| Action | Notes |
| --- | --- |
| New file / New folder | Created inside the selected folder. |
| Rename (F2) | Open tabs follow the new name. |
| Duplicate… | Files only. EDITHA proposes a free name that you confirm. |
| Move to… | Pick the destination folder from a list. There is no drag-and-drop on purpose: too easy to drop in the wrong place. |
| Delete | Asks first. The deleted file stays in EDITHA's history and can be restored. |
| Download / Download as zip | A file, or a whole folder as a zip archive. |
| Copy path | The full `/config/...` path. |
| History… | The saved versions of the file (see [History](#history-and-comparison)). |
| Select for compare / Compare with… | Compare two files side by side. |

- **Upload**: use the upload button, or drag files from your PC onto a folder.
- **Filter by name**: the field above the tree.
- **Images and PDFs** open in a preview instead of the editor: PNG, JPEG, GIF, WebP, AVIF, BMP,
  ICO, SVG and PDF. The header shows the size in pixels; click an image to see it at actual size,
  click again to fit it. Transparent parts show a checkerboard. Esc, the close button or a click on
  a tab brings back the editor.

  ![Image preview](https://raw.githubusercontent.com/Trizompa/ha-addons/main/docs/images/preview.png)
- **System folders** (`.storage`, `.cloud`, `deps`, `tts`, `.git`) are hidden. The eye button shows
  them, **read-only**: Home Assistant manages them and a manual change can break it.

## Editing

- **Save** with Ctrl+S (Cmd+S on a Mac), **save all** with Ctrl+Alt+S.
- **Undo and redo** also undo indentation made with Tab.
- **Find and replace** in the open file: Ctrl+F.
- **Word wrap** and **split view** are in the toolbar. Split view shows two files side by side, or
  two places of the same file: changes made in one column appear in the other.

  ![Split view](https://raw.githubusercontent.com/Trizompa/ha-addons/main/docs/images/split-view.png)

- **Languages**: YAML, JSON, Python, JavaScript, CSS, Markdown and Jinja templates are
  highlighted; other files open as plain text. Images and PDFs open in a preview; other binary
  files and files over 5 MB do not open in the editor, but you can still download them.

### Your work is not lost

- Closing a tab or the page with unsaved changes asks first.
- If the page closes anyway (phone locked, browser closed), EDITHA keeps the unsaved changes as a
  **draft**. Next time it offers to recover them.
- If a file changes on disk while it is open (for example Home Assistant rewrote it), EDITHA warns
  you before saving: you choose whether to reload it or overwrite it.

## Help with Home Assistant

### YAML check, explained

EDITHA checks the YAML while you type. It knows the Home Assistant tags (`!include`,
`!include_dir_*`, `!secret`, `!input`, `!env_var`) and, instead of the parser's cryptic message,
tells you what is wrong and on which line: a missing colon, a line indented to the wrong level, a
tab instead of spaces, a duplicate key.

![A YAML error explained](https://raw.githubusercontent.com/Trizompa/ha-addons/main/docs/images/problems.png)

It also warns about common Home Assistant mistakes that are valid YAML, such as unquoted
`on`/`off`/`yes`/`no` (YAML turns them into true/false).

Click the error count in the status bar (or press Ctrl+Shift+M) for the list of problems; F8 jumps
to the next one.

### Suggestions while you type

Press Ctrl+Space, or just type:

- **entities** with their name and current state, after `entity_id:` or as soon as you type a
  domain such as `light.`;
- **actions** (`light.turn_on`, …) and their fields;
- **`!secret` keys** from `secrets.yaml` (only the names: the values never leave the server);
- **Material Design icons** after `mdi:`, with a preview.

![Entity suggestions](https://raw.githubusercontent.com/Trizompa/ha-addons/main/docs/images/autocomplete-entities.png)

![Icon suggestions](https://raw.githubusercontent.com/Trizompa/ha-addons/main/docs/images/autocomplete-icons.png)

### Follow includes and secrets

Ctrl+click (Cmd+click on a Mac) on `!include file.yaml` opens the file, on `!include_dir_* folder`
shows the folder in the explorer, and on a `!secret` name opens `secrets.yaml` at that key.

### Insert panel

The insert button opens a side panel with two tabs:

- **Entities**: search by name or `entity_id` and insert it at the cursor. The magnifier next to an
  entity shows where it is used in your configuration.
- **Snippets**: ready-made blocks (automation, script, template sensor, triggers, conditions,
  actions, helpers). Tab moves between the fields to fill in. Select some text and save it as a
  **personal snippet**; the pencil edits it.

![Insert panel](https://raw.githubusercontent.com/Trizompa/ha-addons/main/docs/images/insert-panel.png)

### Check, reload, restart

The Home Assistant button in the toolbar:

- **Check configuration**: asks Home Assistant to validate the whole configuration and shows the
  result.
- **Reload YAML configuration**: checks first, then reloads automations, scripts, scenes and the
  other YAML that can be reloaded without a restart.
- **Restart Home Assistant**: asks for confirmation and **always checks first**: if the
  configuration has errors the restart is cancelled, so a typo cannot leave you without Home
  Assistant.

![Home Assistant menu](https://raw.githubusercontent.com/Trizompa/ha-addons/main/docs/images/ha-menu.png)

## Search and replace in all files

The magnifier above the file explorer (Ctrl+Shift+F) searches every file in `/config`, with match
case, whole word and regular expressions. Click a result to open the file at that line. Search for
an `entity_id` with *whole word* to find everywhere it is used.

![Search in all files](https://raw.githubusercontent.com/Trizompa/ha-addons/main/docs/images/search.png)

The arrows button opens **Replace**. *Replace all* changes every match after a confirmation; the
button next to a file replaces only there. Every changed file keeps its previous version in the
history. Files with unsaved changes, `secrets.yaml` and system folders are never touched.

`secrets.yaml` is not searched, so passwords and keys never appear in the results.

## History and comparison

Before every save, delete, rename, move or replace, EDITHA keeps the previous version of the file
(the last **10 versions** of each file). The history button in the toolbar shows them next to the
current content, with the differences highlighted; **Restore this version** brings one back (and
can itself be undone, because the current content is kept too).

![File history](https://raw.githubusercontent.com/Trizompa/ha-addons/main/docs/images/history.png)

To compare any two files: right-click the first → **Select for compare**, then right-click the
second → **Compare with…**. Esc closes the comparison.

The history lives in the add-on's own storage, which is included when you back up the add-on.

## Phone and tablet

EDITHA works in the Home Assistant app. On a narrow screen the file explorer becomes a panel that
slides in from the toolbar button, the toolbar keeps only the main buttons, and on iPhone a small
button next to the cursor hides the keyboard.

| Editor | File explorer |
| --- | --- |
| ![Editor on a phone](https://raw.githubusercontent.com/Trizompa/ha-addons/main/docs/images/phone-editor.png) | ![File explorer on a phone](https://raw.githubusercontent.com/Trizompa/ha-addons/main/docs/images/phone-tree.png) |

## Keyboard shortcuts

On a Mac use Cmd instead of Ctrl.

| Keys | Action |
| --- | --- |
| Ctrl+S | Save |
| Ctrl+Alt+S | Save all |
| Alt+W | Close the tab |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+F | Find and replace in the file |
| Ctrl+Shift+F | Search in all files |
| Ctrl+Space | Suggestions |
| Tab / Shift+Tab | Indent / outdent |
| Ctrl+click | Open an `!include` or `!secret` |
| Ctrl+Shift+M | List of problems |
| F8 | Next problem |
| F2 | Rename (in the file explorer) |
| Esc | Close the history or the comparison |

## Safety and privacy

- **No exposed ports**: EDITHA answers only to Home Assistant's Ingress proxy.
- **Only `/config`**: no file outside your configuration folder can be read or written.
- **Safe saves**: a file is written to a temporary copy and then swapped in, so a full disk or a
  crash never leaves it half written.
- **Secrets**: the values in `secrets.yaml` are shown only when you open that file. They are never
  sent to the browser for suggestions, never searched and never logged.
- **System folders** are read-only.
- **No internet needed**: everything EDITHA uses is inside the add-on.

## Troubleshooting

**The sidebar icon or title did not change after an update.** Home Assistant caches it: turn
*Show in sidebar* off and on again in the add-on page, or restart Home Assistant.

**No entities in the suggestions or in the insert panel.** EDITHA reads them from Home Assistant:
check that Home Assistant is running and press the refresh button in the insert panel.

**A file does not open.** Files over 5 MB and binary files (other than images and PDFs) cannot be
opened; download them instead.

**Something else?** Open an issue on
[GitHub](https://github.com/Trizompa/ha-addons/issues) with what you did, what you expected and,
if possible, the add-on log (add-on page → *Log*).
