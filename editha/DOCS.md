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
- [Local Git](#local-git)
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

- **Toolbar** (top): file explorer, save and save all, undo and redo, find and replace,
  file history, word wrap, split view, outline, insert panel and the Home Assistant menu. On the right:
  language (Automatic (browser), Italiano, English), theme (automatic, light, dark) and About.
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
| Open on the right | Shows the file in the right column of the split view. Not for images and PDFs (an SVG opens there as text), and not on phones. |
| Open as text | SVG files only: they open in the preview, this opens their code in the editor. |
| Rename (F2) | Open tabs follow the new name, and the file's history goes with it. |
| Duplicate… | Files only. EDITHA proposes `name_copy.ext`, which you can change. A YAML copy also gets `.bak` at the end (`automations_copy.yaml.bak`), so Home Assistant does not load it twice; a name ending in `.yaml` asks for confirmation. |
| Move to… | Pick the destination folder from a list. There is no drag-and-drop on purpose: too easy to drop in the wrong place. The history goes with the file. |
| Delete (Del) | Asks first. A copy is kept in EDITHA's history (see [History](#history-and-comparison)); for items larger than 50 MB no copy can be kept, and EDITHA says so and asks again before deleting. |
| Download to your PC / Download as zip | A file, or a whole folder as a zip archive, up to 50 MB. |
| Copy path | The full `/config/...` path. |
| History… | The saved versions of the file (see [History](#history-and-comparison)). |
| Select for compare / Compare with *name* | Compare two files side by side. |

- **Upload**: use the upload button, or drag files from your PC onto a folder. Up to 50 MB per
  file; replacing an existing file asks first, and its previous version goes to the history (if
  the existing file is over 50 MB, EDITHA warns that no copy can be kept).
- **Filter by name**: the field above the tree.
- **Images and PDFs** open in a preview tab instead of the editor: PNG, JPEG, GIF, WebP, AVIF,
  BMP, ICO, SVG and PDF. There is one preview tab, reused by the next image you open. The header
  shows the size in pixels and the current zoom; click an image to see it at actual size (100%),
  click again to fit it. Transparent parts show a checkerboard. The download button in the header
  saves the file to your PC. Close the preview with its tab's × or Esc. To edit an SVG, use
  **Open as text** in its menu.

  ![Image preview](https://raw.githubusercontent.com/Trizompa/ha-addons/main/docs/images/preview.png)
- **System folders** (`.storage`, `.cloud`, `deps`, `tts`, `.git`) are hidden. The eye button shows
  them, **read-only**: Home Assistant manages them and a manual change can break it.

## Editing

- **Save** with Ctrl+S (Cmd+S on a Mac), **save all** with Ctrl+Alt+S.
- **Undo and redo** also undo indentation made with Tab.
- **Find and replace** in the open file: Ctrl+F.
- **Word wrap** and **split view** are in the toolbar. Split view shows two files side by side, or
  two places of the same file: changes made in one column appear in the other. **Open on the
  right** in a file's menu puts it straight into the right column.

  ![Split view](https://raw.githubusercontent.com/Trizompa/ha-addons/main/docs/images/split-view.png)

- **Outline**: the list button in the toolbar opens, next to the editor, the outline of the YAML
  file: in `automations.yaml` one entry per automation, by alias; in `scripts.yaml` one per script;
  in `configuration.yaml` and packages the sections, with the automations, scripts and helpers
  inside. Click an entry to jump to it; the entry where the cursor is stays highlighted, and the
  outline follows your edits. With many entries a filter appears on top. The button turns the
  outline on and off, and EDITHA remembers your choice. It is not available on phones.

  ![Outline](https://raw.githubusercontent.com/Trizompa/ha-addons/main/docs/images/outline.png)

- **Languages**: YAML, JSON, Python, JavaScript, TypeScript, CSS, Markdown and Jinja templates
  (`.jinja`, `.jinja2`, `.j2`) are highlighted; other files open as plain text. Images and PDFs
  open in a preview; other binary files and files over 5 MB do not open in the editor, but you can
  still download them.

### Your work is not lost

- Closing a tab or the page with unsaved changes asks first.
- If the page closes anyway (phone locked, browser closed), EDITHA keeps the unsaved changes as a
  **draft**. Next time it offers to recover them (Esc postpones the choice: the drafts stay, and
  the first time you change one of those files EDITHA asks again). If the file no longer exists (renamed or deleted
  elsewhere), EDITHA offers to recreate it with those changes; a draft of a file that can no longer
  be saved (for example it became read-only) is discarded with a notice. The same choice to
  recreate the file appears if you save a file that was renamed or deleted elsewhere meanwhile.
- With EDITHA open in several windows or devices, each one keeps its own drafts: a window never
  offers, discards or overwrites the drafts of another window that is still open. If a window
  closes without saving (or a phone closes the app), another open window offers its changes
  after about a minute and a half.
- If EDITHA stops responding for a moment (add-on update or restart), keep the page open: the
  changes stay in the tabs and their drafts are written as soon as it comes back. **Reload page**
  in the banner writes the drafts first, and warns you if EDITHA is still unreachable.
- If a file changes on disk while it is open (for example Home Assistant rewrote it), EDITHA warns
  you before saving: you choose whether to reload it or overwrite it.

## Help with Home Assistant

### YAML check, explained

EDITHA checks the YAML while you type. It knows the Home Assistant tags (`!include`,
`!include_dir_*`, `!secret`, `!input`, `!env_var`) and, instead of the parser's cryptic message,
tells you what is wrong and on which line: a missing colon, a line indented to the wrong level, a
tab instead of spaces, an invisible special space pasted from a web page, a duplicate key, a
`{{ … }}` template without quotes, an apostrophe inside `'…'`, a `: ` inside an unquoted text, a
list or `{ }` block used as a key, an alias `*name` with no anchor `&name` before it, an unknown
tag (`!secrets` instead of `!secret`). In the `esphome` folder the ESPHome tags (`!lambda`,
`!extend`, `!remove`, …) are accepted too.

![A YAML error explained](https://raw.githubusercontent.com/Trizompa/ha-addons/main/docs/images/problems.png)

It also warns about common Home Assistant mistakes that are valid YAML, such as unquoted
`on`/`off`/`yes`/`no` (YAML turns them into true/false) or `name:Casa` without a space after the
colon.

Very large files (over 1 MB) are not checked, and get no outline, so the editor stays responsive.

Click the error count in the status bar (or press Ctrl+Shift+M) for the list of problems; F8 jumps
to the next one.

### Suggestions while you type

Press Ctrl+Space, or just type:

- **entities** with their name and current state, after `entity_id:` or as soon as you type a
  domain such as `light.`;
- **actions** (`light.turn_on`, …) after `action:` or `perform_action:` (the action ids, not
  their fields);
- **`!secret` keys** from `secrets.yaml` (only the names: the values are never sent for
  suggestions);
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

Home Assistant reads the files on disk: if some tabs have unsaved changes, EDITHA first asks
whether to **Save all and continue** or **Continue without saving**.

![Home Assistant menu](https://raw.githubusercontent.com/Trizompa/ha-addons/main/docs/images/ha-menu.png)

### Template preview

Put the cursor on a template (or select it) and press **Alt+T**, or use the **Template preview**
button in the toolbar (the curly braces) or the entry in the Home Assistant menu. Without a selection EDITHA takes the value under the cursor, read the way
Home Assistant reads it: also across several lines (`value_template: >`, `|`, quoted text that
wraps). In `.jinja` files it takes the whole file.

Home Assistant renders it with the current state of the entities, as in Developer tools, and the
result appears in a panel below the editor: green for the result, red for a syntax error, orange
for an evaluation error (for example a division by zero).

- While the panel is open the preview updates by itself: while you edit the template, shortly
  after you stop typing, and when you move the cursor (or click) onto another template, also in
  another file. On a line without a template the previous result stays. Selected text is only sent
  with Alt+T or the button (so selecting to copy starts nothing), and in very large YAML files the
  automatic update is off. The refresh button renders again from where the cursor is.
- **Copy** copies the result.
- If the template mentions entities that do not exist (for example `states('sensor.wrong')`), a
  warning appears below the result: Home Assistant gives no error in that case, it returns `unknown`.
- Home Assistant does not say on which line a syntax error is: when it can, EDITHA finds it (an
  `{% if %}` without `{% endif %}`, an unclosed `{{`…) and offers **Go to line N**.
- Esc closes the panel. Variables such as `trigger`, `this` or those of an
automation only exist while the automation runs: here they are empty. The preview never starts
from `secrets.yaml` or its copies.

## Search and replace in all files

The magnifier above the file explorer (Ctrl+Shift+F) opens **Search in files**: it searches every
file in `/config`, with match case, whole word and regular expressions. Click a result to open the
file at that line. Search for an `entity_id` with *whole word* to find everywhere it is used.

![Search in all files](https://raw.githubusercontent.com/Trizompa/ha-addons/main/docs/images/search.png)

The search skips system folders, links, files over 5 MB and binary files (databases, archives,
images and the like). With too many results (2000) or a search that takes too long, it shows the
first ones.

The arrows button opens **Replace in files**. **Replace all** changes every match after a
confirmation; if the search stopped early (too many results), only the listed files are changed; **Replace in *name*** next to a file replaces only there. Every changed file keeps
its previous version in the history. Files with unsaved changes, `secrets.yaml` and its copies,
and system folders are never touched.

`secrets.yaml` and its copies (such as `secrets.yaml.bak` or `secrets_old.yaml`) are not searched,
so passwords and keys never appear in the results.

## History and comparison

Before every save, replace, restore or delete, and before an upload replaces a file, EDITHA keeps
the previous version of the file (the last **10 versions** of each file). Renaming or moving a file
takes its history along, without adding a version. The history button in the toolbar (or
**History…** in the file's menu) shows the versions next to the current content, with the
differences highlighted; **Restore this version** brings one back (and can itself be undone,
because the current content is kept too). History works on text files up to 5 MB.

![File history](https://raw.githubusercontent.com/Trizompa/ha-addons/main/docs/images/history.png)

**Bring back a deleted file**: create a new file with the same name in the same folder, then open
**History…** on it: its versions are still there, including the one kept when it was deleted.
Folders cannot be restored this way, and items larger than 50 MB have no copy (EDITHA warns you
before deleting them).

**Space taken by the history**: in **About** (row *History*, **Space and cleanup…**) or with the
disk button in the history header, EDITHA shows how much disk space the history takes in total and
file by file, biggest first, marking the files that no longer exist. Below that you can delete the
versions older than 7, 30, 90 days, one year or a date you choose: **Preview** first tells you how
many versions of how many files would go and how much space they free, then **Delete N versions…**
asks for confirmation. The last choice, **all**, deletes the whole history (including leftovers of
interrupted saves): to confirm you have to type **DELETE** (**CANCELLA** in Italian). Deleted
versions can no longer be restored; your files in `/config` and unsaved changes are never touched.
The add-on log lists what was deleted.

To compare any two files: right-click the first → **Select for compare**, then right-click the
second → **Compare with *name*** (the name of the first file). Esc closes the comparison.

The history lives in the add-on's own storage, which is included when you back up the add-on.

## Local Git

The **Git** button (the branch, at the top of the file explorer) opens the Git panel in place of
the tree. Everything stays on your Home Assistant: EDITHA only uses the repository in `/config` and
sends nothing outside (no GitHub or other servers).

- If there is no repository in `/config` yet, **Initialise Git repository** creates it (branch
  `main`) together with a basic `.gitignore` file, which keeps out passwords and keys
  (`secrets.yaml` and copies), Home Assistant internal data (`.storage`, `.cloud`, `deps`,
  `tts`…), databases, logs and temporary files. You can edit it like any other file.
- An existing repository or `.gitignore` is used as it is.
- The panel shows the branch, the last commit and the **changes** since the last commit: each file
  with a letter (**M** modified, **N** new, **D** deleted, **C** in conflict) and a checkbox. Clicking the name opens
  the file. The list updates when you save a file with the panel open, or with the refresh button.
- To make a **commit** (a «snapshot» of the files, with a message): keep the files to include
  ticked (all of them at first), write what you changed and press **Commit** (or Ctrl+Enter in the
  message).
- Some files never go into a commit from EDITHA, even if `.gitignore` was changed or is missing:
  they appear with a padlock and cannot be ticked. They are `secrets.yaml` and its copies, Home
  Assistant internal data and credentials (`.storage`, `.cloud`, tokens, databases), files that go
  through a git filter (`.gitattributes`, for example Git LFS or git-crypt: EDITHA runs no external
  programs, so it would store them unfiltered; commit them from a terminal) and other repositories inside `/config`.
- The compare button (two columns) next to a file shows the changes since the last commit, in the same view
  as the file comparison (unsaved changes included).
- **Commit history** lists the commits, newest first. Clicking a commit shows the files it touched;
  for each one you can **compare** that version with the current file or **restore** it as it was
  in that commit (with confirmation). Restoring goes through EDITHA's normal save: the current
  content stays in EDITHA's history, and a file that no longer exists is recreated. Secrets and
  internal data are neither shown nor restored.
- New files that appear by themselves while the panel is open (after a save or a file operation)
  arrive unticked: you decide whether to include
  them.
- During a merge, rebase or cherry-pick started from a terminal, commits from EDITHA are paused: complete or abort it from
  the terminal.

EDITHA's history (the automatic copies on every save) stays separate and keeps working as before.

## Phone and tablet

EDITHA works in the Home Assistant app. On a narrow screen the file explorer becomes a panel that
slides in from the toolbar button, and the toolbar keeps only the main buttons: **History…** is in
the file's menu (long press on the file) and **About** is in the menu of the language button. Split
view, **Open on the right** and the file outline are not available on phones. On phones and
tablets a small button next to the cursor hides the keyboard.

| Editor | File explorer |
| --- | --- |
| ![Editor on a phone](https://raw.githubusercontent.com/Trizompa/ha-addons/main/docs/images/phone-editor.png) | ![File explorer on a phone](https://raw.githubusercontent.com/Trizompa/ha-addons/main/docs/images/phone-tree.png) |

## Keyboard shortcuts

On a Mac use Cmd instead of Ctrl and Option instead of Alt; two exceptions: redo is Cmd+Shift+Z
and suggestions stay Ctrl+Space.

| Keys | Action |
| --- | --- |
| Ctrl+S | Save |
| Ctrl+Alt+S | Save all |
| Alt+W | Close the tab (Option+W on a Mac) |
| Ctrl+Z / Ctrl+Y | Undo / redo (Cmd+Z / Cmd+Shift+Z on a Mac) |
| Ctrl+F | Find and replace in the file |
| Ctrl+Shift+F | Search in all files |
| Ctrl+Space | Suggestions (Ctrl also on a Mac) |
| Tab / Shift+Tab | Indent / outdent |
| Ctrl+click | Open an `!include` or `!secret` |
| Ctrl+Shift+M | List of problems |
| F8 | Next problem |
| F2 | Rename (in the file explorer) |
| Del | Delete (in the file explorer) |
| Alt+T | Preview the template under the cursor (Option+T on Mac) |
| Esc | Close the history, the comparison or the image preview |

## Safety and privacy

- **No exposed ports**: EDITHA answers only to Home Assistant's Ingress proxy.
- **Only `/config`**: no file outside your configuration folder can be read or written.
- **Safe saves**: a file is written to a temporary copy and then swapped in, so a full disk or a
  crash never leaves it half written.
- **Secrets**: the values in `secrets.yaml` are shown only when you open that file. They are never
  sent to the browser for suggestions and never logged; `secrets.yaml` and its copies are never
  searched or replaced.
- **System folders** are read-only.
- **No internet needed**: everything EDITHA uses is inside the add-on.

## Troubleshooting

**The sidebar icon or title did not change after an update.** Home Assistant caches it: turn
*Show in sidebar* off and on again in the add-on page, or restart Home Assistant.

**No entities in the suggestions or in the insert panel.** EDITHA reads them from Home Assistant:
check that Home Assistant is running and press the refresh button in the insert panel.

**A file does not open.** Files over 5 MB and binary files (other than images and PDFs) cannot be
opened; download them instead (up to 50 MB).

**Something else?** Open an issue on
[GitHub](https://github.com/Trizompa/ha-addons/issues) with what you did, what you expected and,
if possible, the add-on log (add-on page → *Log*).
