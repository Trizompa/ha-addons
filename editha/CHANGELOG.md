# Changelog

Italian version: [CHANGELOG.it.md](CHANGELOG.it.md).

## 0.43.0

- **× to clear** every filter and search field (file tree, Insert panel, outline, folder picker, gallery, search in all files).
- **Clearer icons**: name filters show a funnel, the magnifier only means search inside all files, find and replace has its own icon, and excluding a file from Git uses a crossed-out circle (the eye only shows or hides system folders).
- **Buttons that switch something on and off** stay highlighted while active and switch it off with a second click: find and replace, template preview, and the problems count in the status bar.

## 0.42.0

- **Image gallery**: right-click a folder → **Show as gallery** shows thumbnails of its images, with name and size. Filter by name, three thumbnail sizes, click for a large view with ← and → to browse, right-click for the usual file commands. Animated GIFs and SVGs move. (Thanks for the idea!)
- The message over an underlined word (for example an unknown entity) now wraps instead of covering the side panels.

## 0.41.0

- **States and attributes of the entity you are working on**: in the Insert panel a box shows the entity of the block where the cursor is, with its states (current one first, then `hvac_modes`, select options, `on`/`off`…) and attributes (`current_temperature`, `hvac_action`…). A click inserts the value at the cursor, with quotes when Home Assistant needs them. Ctrl+Space shows the same values in the editor after `attribute:`, `state:`, `to:`, `from:` and in `state_attr(…)`, `is_state(…)`; they never pop up by themselves.
- **Home Assistant hints button** (light bulb in the toolbar): turns the box, these suggestions and the unknown entity warning on and off. EDITHA remembers the choice.
- Fixed: the unknown entity warning only appeared after typing something; now it appears as soon as the file opens.

## 0.40.0

- **Unknown entities**: after `entity_id:`, `entity:` and `entities:` EDITHA warns when the entity does not exist in your Home Assistant (a yellow underline). When a similar entity exists, the message suggests it and **Replace with…** fixes it in one click. It is a warning, not an error, because a newly created entity only exists after a restart or a reload.

## 0.39.1

- Wording: EDITHA now says **app** instead of add-on, as Home Assistant does since 2026.2 (interface messages, documentation, README). The installation steps also show the old menu path for older Home Assistant versions.

## 0.39.0

- **Faster installs and updates**: EDITHA now comes as a ready-made image for both `amd64` and `aarch64` (Raspberry Pi and similar). Home Assistant downloads it instead of building it on your device, so installing or updating takes seconds instead of minutes.
- The images in the Documentation tab of Home Assistant now show up.

## 0.38.0

- Git panel and guide: a short note explains the difference between EDITHA's file history, Git and a Home Assistant backup.
- Behind the scenes: the main part of the interface has been split into smaller pieces (no visible change), so future fixes are safer.
- Developer documentation and the names of the automatic checks are now in English.

## 0.37.0

- The `.gitignore` that EDITHA creates for a new Git repository is now in English, like the rest of the app's defaults. It also covers every `*secrets*.yaml` copy with a single line. A `.gitignore` created by an earlier version keeps working as it is, Italian heading included.

## 0.36.0

Final review before 1.0.

- **Secrets, stricter**: any file with "secrets" in its name and a `.yaml`/`.yml` extension (for example `old_secrets.yaml`, `20240101_secrets.yaml`) is now treated like `secrets.yaml`: never searched, replaced, put in a folder ZIP or used for the template preview. Unsaved changes to these files are no longer kept as drafts, so their values never sit in EDITHA's data folder.
- **Folder ZIPs** also leave out copies of `.storage` and `.cloud` found deeper (for example in other add-ons' backups).
- **Other sites**: requests that a browser marks as coming from another website are refused, so a malicious page cannot make EDITHA restart Home Assistant through your browser.
- **Replace all** works with more than 1000 files in the results (up to 2500).
- **File history**: renaming a file onto the name of a file deleted earlier joins the two histories, newest first, instead of hiding the renamed file's versions.
- **Restart**: on some installations a restart that went through was reported as an error; now it is reported as sent.
- Split view: after choosing a tab in the tab bar, Save, Undo and the toolbar act on that file (before, they could still act on the right column).
- Option+W (Alt+W) no longer closes the tab while you type in a text field (on a Mac it types ∑).
- File explorer: opening two folders quickly no longer closes one of them; on a Mac the delete key deletes the selected item.
- Git panel: clearer error messages in English; the Excluded list no longer shows an outdated state after quick clicks.
- Welcome page: on a Mac the shortcuts show ⌘ ⌥ ⇧.
- The name is written EDITHA everywhere (sidebar, page title, messages); the English interface uses “curly” quotes.
- Documentation: guides checked against the program (toolbar, shortcuts, limits, safety) and developer notes updated.

## 0.35.0

- **Git, expandable folders**: the arrow next to a new folder shows its files, each with its own checkbox and crossed-out eye. This way you can put only some files of a folder into the commit, or exclude them for good. The folder's checkbox becomes "partial" and the count says how many files go in (for example `3 of 8 files`). At most 200 files per folder are shown: the others go in only with the whole folder.
- Toolbar: with no file open, the **Word wrap**, **File outline** and **Insert entity or snippet** buttons are turned off, like search and template preview already were.
- English documentation: images now show up too.

## 0.34.0

- **ZIP without passwords**: when you download a folder as a zip, `secrets.yaml` and its copies are always left out, and EDITHA says so with a notice. The file on its own downloads as before.
- Git: after a commit, the first file you save appears already checked (before, it arrived unchecked and the button said "Commit (0 files)").
- Documentation: images redone with today's interface, plus new ones for the template preview and the Git panel; requirements reordered.

## 0.33.0

- The template preview is no longer in the Home Assistant menu (which now only has check, reload and restart): the `{}` button in the toolbar and Alt+T remain.
- The **File history** button in the toolbar behaves like the others: it stays highlighted while the history is open, and a second click closes it.
- Git panel: the legend is in a box, one entry per line (checkbox, letters N/M/D, crossed-out eye, compare); removed the sentence about the repository staying local.
- Start page: only the shortcuts, without the repeated logo and name. About window: removed the History line (the history space window opens from the History panel).
- The motto is in quotes: “Every Day I Tweak HA”.

## 0.32.0

- **Git, Excluded**: in the Git panel a section lists the files and folders excluded with the crossed-out eye; **Include** brings them back, without opening `.gitignore` by hand. The added lines go under a heading in `.gitignore`.
- Below the list of changes a legend explains the letters (N new, M modified, D deleted), the checkbox (what goes into this commit) and the crossed-out eye (exclude for good).
- The compare button only appears when there is a commit to compare with (not before the first commit, nor for new files).
- The basic `.gitignore` of new repositories also excludes the temporary files left by Home Assistant (`.name.tmp.…`); in an existing repository you exclude them with the crossed-out eye.
- If after "Include" another `.gitignore` rule still excludes the same file, EDITHA says so.

## 0.31.0

- **Git, simpler first commit**: a folder git has never seen is now a single row with the number of files (for example `custom_components/ · 1450 files`), instead of thousands of rows. Committing a folder includes its files, except secrets and internal data.
- **Exclude**: the crossed-out eye next to a new file or folder adds it to `.gitignore`, so it disappears from the list and from all commits.
- On the first commit a notice suggests excluding the folders you don't need first; with more than 2000 rows the commit is blocked until you exclude some folders.
- On phones the Git panel is no longer transparent.

## 0.30.0

- **Full local Git.** In the Git panel:
  - the compare button next to each changed file: the differences from the last commit, in the compare view;
  - **Commit history**: the list of commits, newest first; a click shows the files touched;
  - for each file in a commit you can **compare** that version with the current file or **restore** it (with confirmation). The restore goes through EDITHA's normal save, so the current content stays in the history; a file that no longer exists is recreated.
- Secrets and Home Assistant internal data are never shown or restored from the repository.
- **Security** (also affects 0.28 and 0.29): a `.git/config` written by another program could start a command by asking git to download missing objects. Now git never uses the network or downloads objects, in any case.
- File contents from the repository are read strictly: a non-UTF-8 file or a link is not shown or restored as garbled text.

## 0.29.0

- **Local Git: changes and commits.** The Git panel now shows the files changed since the last commit (**M** modified, **N** new, **D** deleted), each with a checkbox. Write a message and press **Commit** to save a "snapshot" of the checked files. The list updates by itself when you save a file with the panel open; a click on the name opens the file.
- These never go into a commit, even if `.gitignore` was changed or is missing: `secrets.yaml` and its copies, Home Assistant internal data and credentials (`.storage`, `.cloud`, tokens, databases), files with a git filter, and other repositories inside `/config`. They appear with a padlock and the reason.
- New files that appear while the panel is open arrive unchecked. The list also updates after creating, deleting, moving or uploading files.
- Security: EDITHA runs git with external programs turned off (filters, hooks, signing, pager…), even if `.git/config` sets them.

## 0.28.0

- **Local Git, first step**: new **Git** button at the top of the file explorer. It opens a panel that, if there is no repository in `/config` yet, creates one with **Initialise Git repository** (branch `main`) together with a basic `.gitignore` that keeps out `secrets.yaml` and its copies, Home Assistant internal data, databases, logs and temporary files. An existing repository or `.gitignore` is used as it is. Everything stays on your Home Assistant: no push or pull. Status, differences, commits, history and restore come in the next steps.
- The git program is now included in the add-on.

## 0.27.1

- **Template preview**: with the panel open, just click (or move the cursor) on another template, even in another file, and the preview updates by itself. On a line without a template the previous result stays; moving within the same template doesn't call Home Assistant again. Selected text is only sent with Alt+T or the button; in very large YAML files automatic updating is turned off so the editor doesn't slow down. After a connection error, moving the cursor tries again.

## 0.27.0

- **Template preview**, second step:
  - button in the toolbar (the curly braces), in addition to Alt+T and the Home Assistant menu;
  - the preview updates by itself while you edit the template;
  - **Copy** button for the result;
  - a warning if the template refers to entities that don't exist (in that case Home Assistant answers `unknown` with no error);
  - for syntax errors EDITHA finds the line (unclosed block, open `{{`…) and offers **Go to line N**.

## 0.26.0

- **Jinja template preview**: with the cursor on a template (or with it selected) press **Alt+T**, or choose **Template preview** in the Home Assistant menu. EDITHA sends only that template to Home Assistant, read the way HA reads it (including `|` and `>` blocks and quoted text over several lines), and shows the result in a panel below the editor: green for the result, red for a syntax error, orange for an evaluation error. The preview never starts from `secrets.yaml` or its copies.

## 0.25.0

- **Delete the whole history**: the menu of versions to delete has an **all** entry. The preview shows how many versions and how much space, then to confirm you have to type **DELETE** (the message warns that it cannot be undone). Leftovers of interrupted saves are deleted too. Versions created after the preview, the files in `/config` and unsaved changes are not touched; the add-on log records the deletion.
- The menu now says in full what it deletes ("older than 30 days", …).

## 0.24.0

- **History cleanup**: in the *History: space and cleanup* window you can delete versions older than 7, 30 or 90 days, a year, or a date of your choice. First **Preview** shows how many versions of how many files would go and how much space would be freed, then an explicit confirmation is required. At the end it says how much space was freed, and the add-on log lists what was deleted. Files in `/config` are never touched.

## 0.23.0

- **Space taken by the history**: new *History: space and cleanup* window, from **About** (*History* line) or from the disk-shaped button in the history header. It shows how much disk space the history really takes, in total and file by file (largest first), with the number of versions, the date of the latest one and the files that no longer exist. For now it only shows: cleanup comes in the next steps.
- Sizes are written with a decimal comma in Italian and go up to GB.

## 0.22.4

- If two windows recover at the same moment the changes left by a third, closed window, now only one of them gets them: the other opens nothing and says they have already been recovered (or discarded) elsewhere. Before, they ended up in both.

## 0.22.3

- **Several windows or devices open at once**: each one keeps its own drafts of unsaved changes. A window no longer offers, discards or overwrites the drafts of another window that is still open (for example EDITHA on the PC and on the phone). When you reload the page, your own drafts are recognised and offered as before.
- If a window closes without saving, or the phone suddenly closes the app, another open window offers its changes after about a minute and a half; the question doesn't appear in hidden tabs and doesn't interrupt a file you are already working on.
- After an add-on restart, the drafts of windows that are still open are not mistaken for abandoned ones.
- Interface build: no more esbuild error in the log when the output goes to a file.

## 0.22.2

- Drafts: if at startup you answer the question about unsaved changes with Esc, the drafts really are kept for later. Before, the first change to the same file replaced them; now, at the first change to one of those files, EDITHA asks whether to recover or discard them.
- The question that appears while you type ignores keys pressed out of momentum (Tab, space, Enter) until you pause: you can no longer discard a draft by mistake.
- Pending drafts follow the file if you rename or move it, and are removed if you delete it.

## 0.22.1

- A file with mixed line endings (partly Windows, partly Linux) shows normal lines again: with 0.22.0 some lines appeared joined together. These files are saved with Linux line endings; all-Windows files stay Windows.
- Reloading a file from disk (after a replace, a restore or a conflict) no longer silently changes the line endings.
- More precise exclusion of secrets: `secret_sensori.yaml` or `secret-porta.yaml` are normal files in search again; `secrets*.yaml` and copies of `secret.yaml` stay excluded.

## 0.22.0

Second round of complete review, more in-depth: mostly data safety.

**No lost changes**
- Deleting a file or folder over 50 MB, or replacing it by uploading a new one, leaves no safety copy: now EDITHA says so **beforehand** and asks for a second confirmation (before, the confirmation promised a copy that was not made).
- A copy kept on deletion can be restored up to 50 MB (before, only up to 5 MB).
- If Home Assistant (or another program) rewrites a file right while you save it, EDITHA no longer overwrites its change: it asks what to do, as for any conflict.
- If EDITHA stops responding for a moment (update, restart), changes written in the meantime are kept as soon as it is back; "Reload page" writes the drafts first and warns if changes would be lost.
- Drafts are saved even when you type continuously, without pauses.
- Draft of a file renamed or deleted elsewhere: EDITHA offers to **recreate** it with the changes instead of discarding them. The same when saving a file that has disappeared in the meantime.
- The question about drafts comes before the tabs reopen, so you don't overwrite a draft by typing right away.
- Files with Windows line endings (CRLF) stay that way when saved (before, they became Linux line endings).
- Ctrl+S on an unmodified file no longer offers to overwrite the file changed on disk; an automatic reload no longer erases text you just typed, and keeps the cursor and scroll position.
- When you close a tab with "Save", if you kept typing in the meantime, the tab stays open.

**Sturdier history**
- No duplicate versions (failed and repeated saves, replaces that change nothing, restore and undo): real versions are no longer pushed out of the 10 kept.
- If the clock goes back, or the disk is full, no versions are lost and no truncated copies remain; copies are written to disk before deleting or overwriting.

**Search, secrets and downloads**
- Copies of `secrets.yaml` are excluded from search in every form (including `secrets.yaml_copy.bak` created by "Duplicate", `secrets.yaml.old`, `secret.yaml`…), and the `.storage`, `.cloud` and `.git` folders are skipped even inside other folders.
- "Whole word" works with accented letters (searching for "caff" no longer finds "Caffè"); regular expressions no longer split emoji.
- The "Replace" confirmation shows the right number of occurrences even beyond the 200 shown, with correct singular and plural; a wrong regular expression is reported right away.
- The ZIP of a folder no longer freezes EDITHA for seconds, and odd names are made harmless.

**YAML check and editor**
- New explained errors: "invisible" tabs and spaces pasted from a web page, unknown tags (`!secrets` → "did you mean !secret?"), an apostrophe inside `'…'`, a colon inside unquoted text, `\d` inside double quotes, `{% %}` at the start of a value, missing space after the colon (`name:Casa`).
- JSON pasted with tabs is no longer reported as an error; in the `esphome/` folder ESPHome tags (`!lambda`, `!extend`…) are accepted.
- Files over 1 MB are not checked or outlined (before, the interface froze for seconds); the bottom bar says so.
- `mdi:` icons all have the right name (37 were wrong, e.g. `molecule-co2`).
- A snippet saved from a selection keeps the right indentation.
- When you change language, the YAML check messages update right away.

**Keyboard and interface**
- Windows: AltGr+S (Polish, Romanian, Hungarian keyboards…) types the letter again instead of saving everything. Shortcuts follow the keyboard's letter (AZERTY included).
- Alt+W closes the file of the column you are using; Esc on a menu closes only the menu; with a dialog open, shortcuts don't act on the files underneath.
- On Mac, button tooltips show ⌘, ⌥ and ⇧ (Redo is ⌘⇧Z).
- When you click two files in a row, the last one clicked stays open.
- Error messages translated into English too; preview with precise errors (file gone, too large).

## 0.21.0

Complete code review: many small fixes, no major new features.

**Find and replace**
- Replace with regular expressions: `$1`, `$&`, `$<name>` and before/after conditions (lookaround) now give the same result as the preview.
- Copies of `secrets.yaml` (e.g. `secrets.yaml.bak`, `secrets_old.yaml`) and links to `secrets.yaml` are also excluded from search and replace.
- A file that is too large is skipped instead of blocking everything; an error on one file doesn't stop the others; the same file reached through two paths is changed only once.
- A new search stops the one still running.

**Files and history**
- A save inside a folder that is being deleted or moved waits for the operation to finish, instead of colliding with it.
- Renaming a file no longer fails if its history cannot be moved.
- With a full disk, creating a file no longer leaves a half-empty file behind.
- Size limits are also checked when creating, when replacing an uploaded file and when restoring a version.
- Downloading a folder with too many items for a ZIP gives a clear error.
- **Open as text** (right-click menu) for SVG files, which otherwise open in preview. "Open on the right" no longer appears for images and PDFs.

**Editor and YAML check**
- New explanations: a `{{ … }}` template used without quotes at the start of a value, a key that is a list or a block, an alias `*name` that doesn't exist.
- Two duplicate keys in different places of the file are both reported; at most 200 problems per file.
- Ctrl+click: no more fake links inside quotes; `!include` in a `[a, b]` list and paths starting with `/config` work.
- Shortcuts (Ctrl+S, Ctrl+F, Alt+W…) independent of keyboard layout and Mac; Esc closes, in this order, history, compare and preview, but not while typing in a field.

**Drafts and interface**
- Unsaved changes are kept more reliably when the page closes, even in large files.
- The draft of a file that has been deleted in the meantime or can no longer be saved is discarded with a notice, instead of being offered again every time you open EDITHA.
- Split view: the bottom bar follows the right column; opening a file on the right no longer hides it behind the preview.
- The file outline clears its filter when you change file; the history ignores answers that arrive after it is closed; the compare view updates right away.
- Clearer error messages ("not a file", "no preview for this file type"…).

## 0.20.2

- History: if the window is already open and you ask it for another file, it now shows that file's versions (before, those of the previous file stayed). A slow answer for the previous file can no longer overwrite the right one.
- Documentation: preview and file outline also in the add-on introduction and in the README; Esc also closes the preview.

## 0.20.1

- In the tree, empty folders no longer have the arrow to expand them: you can see right away that they contain nothing.

## 0.20.0

- **File outline**: new button in the toolbar (bulleted list) that opens the outline of the YAML file next to the editor. In `automations.yaml` there is an entry for each automation, shown by its alias; in `scripts.yaml` one per script; in `configuration.yaml` and in packages the sections, with the automations, scripts and helpers inside. A click takes you to the entry; the one where the cursor is stays highlighted and the outline updates while you type. With many entries a filter appears. The button turns the outline on and off, and EDITHA remembers the choice. Not available on phones.

## 0.19.1

- The preview of images and PDFs has **its own tab** in the tab bar: you switch from the preview to text files and back like between normal tabs, and close it with its ×. There is only one such tab: the next image you open reuses it. When you close all text files, the preview stays in front.
- Next to the dimensions the **zoom** appears (e.g. "588 × 900 px · 82%"): you can see right away whether the image is fitted to the window or at actual size.
- At actual size the image stays centred instead of moving to the left; if it is larger than the window, you scroll.
- With the preview in front, save, undo and the other editor actions no longer act on the text file hidden underneath; the tree and the bottom bar point to the image.

## 0.19.0

- **Image and PDF preview**: when you click an image (PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, SVG) or a PDF in the tree, EDITHA shows it in place of the editor instead of saying the file is not text. At the top: name, size in pixels and a button to download it; a click on the image switches to actual size and back; transparent parts are shown on a checkerboard. Esc, the X or a click on a tab take you back to the editor.
- In the tree, images and PDFs have their own icon.
- Security: an SVG image cannot run code even when opened directly.

## 0.18.2

- Add-on description in the store: "Smart file editor for Home Assistant". The motto "Every Day I Tweak HA" stays in the interface, the logo and the documentation.

## 0.18.1

- New file and new folder are now only in the buttons above the file tree (and in the right-click menu): removed the duplicate from the top bar.

## 0.18.0

- **Complete documentation**, in English (the add-on's *Documentation* tab) and in Italian (`DOCS.it.md` on GitHub), with images of every feature.
- YAML error also explained when the colon between key and value on the same line is missing: `below 30` → "Line 10 is missing the colon after “below”: it should probably be “below: 30”".
- About: the developer appears with the GitHub alias (Trizompa), with a link to the profile.
- Add-on description in the store: "Every Day I Tweak HA – the Home Assistant configuration editor".

## 0.17.2

- On phones the top bar shows only the name EDITHA, without the logo: more room for the buttons.

## 0.17.1

- New motto: **Every Day I Tweak HA** (the initials form the name). In the interface the name is written in capitals: EDITHA.
- Above the file tree there is no longer the "File explorer" label, which wrapped onto two lines on narrow screens: only the buttons remain.

## 0.17.0

- **Edit personal snippets**: in the Insert → Snippets panel, the pencil next to each personal snippet opens a dialog to change its name and text (Tab inserts two spaces, as in the editor).

## 0.16.1

- Editha icon in the sidebar: `mdi:pencil`. To see it, after the update turn "Show in sidebar" off and on again on the add-on page (or restart Home Assistant).

## 0.16.0

- **Compare two files**: right-click a file → "Select for compare", then right-click another file → "Compare with …". The two files are shown side by side with the differences highlighted (in a single column on phones). If a file is open with unsaved changes, the editor text is compared. Esc closes the comparison.
- New Editha icon in the Home Assistant sidebar: `mdi:pencil-circle-outline`.

## 0.15.0

- **Replace in several files**: in the "Search in files" panel, the button with the arrows opens the "Replace with" field. "Replace all" changes every occurrence found; the button next to each file replaces only in that file. Before changing anything Editha asks for confirmation and keeps the previous version of each file in its history, from which it can be restored. With regular expressions you can use groups (`$1`).
- Safeguards: open files with unsaved changes are skipped (Editha says so), as are `secrets.yaml`, system folders and files changed in the meantime. Open tabs update right away with the new text. A regular expression that is too slow changes no files.

## 0.14.0

- **MDI icons**: when you type `mdi:` the editor suggests Material Design icons by name, each with its preview (e.g. `mdi:lightb` → lightbulb, lightbulb-outline, …). The icon list (~7400) is downloaded only the first time it is needed.
- "Search all files" now stays only as the magnifying glass above the file tree (and with Ctrl+Shift+F): removed the duplicate from the top bar.

## 0.13.2

- **Hide the keyboard on iPhone**: the button now appears next to the cursor, on the right side of the editor, while you type. Before, it was in the top bar, which iOS scrolls off the screen when it opens the keyboard, so it couldn't be seen. Language and theme always stay in their place.
- Searching all files no longer looks inside `secrets.yaml`: passwords and keys don't appear in the results.

## 0.13.1

General code review, with these fixes:

**Saves and drafts**
- Two Ctrl+S in quick succession (with a slow network or HA) gave a false "File changed outside Editha" and, choosing "Reload from disk", the latest changes were lost. Now saves of the same tab are queued.
- A draft written during a save stayed on the server and was offered again the next time. Now old drafts are deleted; a draft identical to the file on disk is no longer offered.
- Drafts and session sent when the page closes reach their destination even if the page closes immediately.

**Search**
- A "pathological" regular expression (e.g. `(a+)+$`) could freeze Editha for minutes. Now search runs separately from everything else and stops after 8 seconds, showing the results found up to then.
- In very long lines, text found beyond the 400th character is now visible and highlighted.
- Clearing the search field no longer brings back the results of a previous search.

**Files**
- Two moves to the same name at the same instant could make a file disappear. Now one of the two stops with "already exists".
- When you move or rename a folder, the history of the files inside follows it.
- The history of a file opened through a link is now that of the real file.
- Very large files and folders (over 50 MB) are deleted without a safety copy, instead of filling the add-on's space or failing; Editha points this out. Duplicating a folder over 50 MB is not allowed.
- Downloading a folder with a huge file no longer runs out of memory.
- Errors such as "disk full" or "permission denied" are now explained instead of a generic "internal error".
- `secrets.yaml` is read with a real YAML reader: a multi-line value can no longer appear among the suggestions as if it were a key.

**YAML check**
- `key: &anchor` and `key: !!map` followed by a block are no longer flagged as errors, and no longer hide the errors that follow.
- No warnings about several `<<: *anchor` in the same block, which HA merges.
- No warnings about `!secret on` or `!input yes`, which are names, nor about icon lists like `- mdi:home`.
- No warnings about the indentation of inner lines of multi-line `[ ]` and `{ }`.
- The name of the repeated key is now the right one even with quotes or inside `{ }`.
- When you change language, the check messages change language right away too.

**Other**
- Ctrl+click on `!include /config/…` (absolute path) opens the right file; links inside comments are ignored.
- Esc on a menu no longer also closes the open history. The history closes if the file is moved or deleted.
- When you close an inactive tab with changes, the previous tab stays active.
- The "Fold"/"Unfold" tooltips are now translated; file names with accented letters respect the disk's length limit.

## 0.13.0

- **Search all files** (Ctrl+Shift+F, toolbar button or magnifying glass in the tree): the search takes the place of the tree in the sidebar. Options for match case, whole word and regular expression. Results are grouped by file, with the line and the found text highlighted; a click opens the file with the text selected. System folders, databases and binary files are excluded.
- **Where an entity is used**: from the Insert panel, button next to each entity; or with the cursor on an `entity_id` and Ctrl+Shift+F. It searches for the whole word, so it finds `light.cucina` even inside templates (`states.light.cucina.state`) but not `light.cucina_2`, and shows the entity's name and state.

## 0.12.0

- **Move to…** in the context menu of files and folders (on phones too, with a long press). You choose the destination folder from a filterable list; you can't move into the folder where the file already is, nor a folder into itself, nor into system folders. Open tabs, drafts and the version history follow the file. No drag and drop, to avoid accidental moves.

## 0.11.0

- **`!secret`**: when you type `!secret ` the editor suggests the keys of `secrets.yaml` (names only: the values never leave the server). Like HA, it looks for `secrets.yaml` in the file's folder and then in the folders above, up to `/config`.
- **Ctrl+click** (Cmd+click on Mac) on links, which are underlined with dots:
  - on `!include file.yaml` it opens the file (path relative to the file's folder, as in HA);
  - on `!include_dir_named`, `!include_dir_list`, `!include_dir_merge_…` it opens the folder in the tree;
  - on `!secret key` it opens `secrets.yaml` at the line of that key.

## 0.10.4

- Very narrow screens (below 370 px): only the logo stays in the bar, so all the buttons fit and the page no longer shifts sideways cutting off the name and the status bar.

## 0.10.3

- Fixed: after a key without ":", the correct lines below were also flagged as wrong (for example "All mapping items must start at the same column" on `max:`). Now for that block only the explanation of the line to fix remains.

## 0.10.2

- Clearer explanations when a line is indented more than the one above:
  - if the line above is missing the colon: "Line 28 is missing the colon after “car_wican”: to contain the lines below it must be “car_wican:”";
  - if the line above already has a value: "Line 12 already has a value (“name: Casa”), so it cannot contain line 13";
  - in other cases the message says which line to fix and how.

## 0.10.1

- Fixed: in the dark theme, the list for choosing the file of the right column (split view) showed light text on a white background, unreadable on Windows.

## 0.10.0

- **Clearer YAML check**: for indentation errors Editha explains what is wrong and where, with line numbers. For example "Line 9 is indented by 5 spaces: no block above starts there (possible levels: 0, 2, 4, 6, 8)", or "to belong to the list item on line 2 it needs 4 spaces, aligned with “platform”". Repeated keys also say which key it is.
- **New warnings** for typical Home Assistant mistakes that are still valid YAML:
  - `on`/`off`/`yes`/`no` without quotes, which HA reads as true/false (`to: on` in a trigger);
  - `key:value` without a space after the colon, read as text;
  - odd indentation in a file that goes in steps of 2.
- **List of problems**: a click on the "N errors · N warnings" count in the bottom bar (or Ctrl+Shift+M) opens the full list, with the line number of each one; a click takes you to the line.

## 0.9.1

- About: developer Trizompa; removed the reference to File Editor Plus.
- Documentation and license updated with the author's name.

## 0.9.0

- **Split view in two columns** (PC and tablet only): button in the toolbar, or "Open on the right" in a file's menu. In the right column you choose which of the open files to show; it can also be the same file as the left column, to see two different places: changes made in one column appear right away in the other. Save, Undo, Find and Insert act on the column used last (marked by a blue line). The split view stays when you leave and come back.
- **About**: button next to language and theme with developer (Trizompa), GitHub, repository, version, license and the libraries used. On phones it is in the language menu.

## 0.8.1

- Fixed on iPhone: dragging the editor to the right past the edge, the iOS bounce effect also moved the line-number column. Now scrolling stops at the edges, also for the page and for the history comparison.

## 0.8.0

- **Drafts of unsaved changes**: while you type, Editha keeps the changes not yet saved (after a one-second pause, and immediately when the page is closed or you switch to another app). If you close the page, HA restarts or the phone closes the app, when you reopen it Editha asks whether to recover or discard them. Recovered changes go back to their tab, to be saved; if the file changed on disk in the meantime, Editha asks what to do when you save.

## 0.7.1

- **Phone: "Hide the keyboard" button**. On iPhone the keyboard only closes when the editor loses focus, and the page had no way to do that: now, while you type, the keyboard button appears in place of language and theme. Opening a file on a phone no longer opens the keyboard by itself.
- **Safer Duplicate**: files only. The copy of a YAML file is proposed as `name_copy.yaml.bak`, which Home Assistant doesn't load (no duplicate automations or sensors in `packages` or in `!include_dir_…` folders); Editha still shows it as YAML. A name ending in `.yaml` must be confirmed.
- Between the text "Easy Developer IDE for The HA" and the first button, the same distance as between the logo and "Editha".

## 0.7.0

- **File history**: "File history" button in the toolbar, or "History…" entry in a file's menu. It lists the versions kept by Editha (before every save, restore or deletion), compares them with the current content (side by side on PC, in a single column on phones) and restores the chosen one. The replaced content becomes a version in turn, so the restore can be undone.
- **10 versions per file** kept instead of 50 (configurable with `EDITHA_BACKUP_KEEP`); extra versions disappear at the next save.
- **Duplicate** files and folders from the context menu, with a proposed name for the copy (`name_copy.yaml`).
- On phones the tree's context menu opens with a long press.
- Top bar on phones: all buttons fit on the row even on iPhone (before, the theme was cut off).

## 0.6.1

- Editha logo and name in the top-left corner; the button that shows/hides the tree moves together with the other controls.
- Fixed: on very short windows the start screen covered the toolbar buttons.

## 0.6.0

- **Upload from PC**: button in the tree, "Upload files here…" entry in a folder's menu, or by dragging files from the PC onto a folder. If a file already exists Editha asks whether to replace it; the previous version stays in the backups. System folders stay protected.
- **Download to PC**: "Download to your PC" for a file (images and binary files too), "Download as zip" for a folder.
- Limit of 50 MB per single transfer (configurable with `EDITHA_MAX_TRANSFER`).

## 0.5.0

- Interface in Italian and English: language selector in the top bar (Automatic, Italiano, English). The choice is remembered and applies immediately, without reloading the page; "Automatic" follows the browser language.
- Also translated: the editor's search panel, the YAML validator messages and the built-in snippets (names and example texts).

## 0.4.2

- Fixed: entities, autocomplete and the Home Assistant menu didn't work in the add-on ("Home Assistant is not reachable from here"). The Supervisor token is now read even when startup goes through s6-overlay; the log says at startup whether the HA APIs are available.
- Editor font at 13 px on PC (14 px on phones).
- After an update the new interface is loaded without a forced browser refresh.

## 0.4.1

- If Editha doesn't respond (add-on updating or restarting with the page open) a notice appears with "Reload page", which disappears by itself when the server is back; after an add-on update the notice asks you to reload to use the new version.
- Reads are retried once before reporting an error.
- Space between "Editha" and "Easy Developer IDE for The HA" equal to the one between logo and name.

## 0.4.0

- **Home Assistant** menu in the toolbar: configuration check, YAML configuration reload and restart. Reload and restart only start if the check passes; HA errors are shown in full and the outcome is the real one.
- **Insert** panel: entities of your own HA (name, `entity_id`, state) and snippets, built-in and personal ("Save selection as snippet").
- Autocomplete of entities and actions as you type (`light.`, `entity_id:`, `action:`), with the current state.
- Line-number column narrower and closer to the code on desktop too.
- More space between "Editha" and "Easy Developer IDE for The HA".
- Settings are saved with POST instead of PATCH (more compatible with proxies).

## 0.3.1

- Simplified description: "Easy Developer IDE for The HA".

## 0.3.0

- New name: **Editha** – Easy Developer IDE for The HA. The slug changes from `edith` to `editha`: for Home Assistant it is a new add-on, so you need to install Editha and uninstall Edith (Edith's settings and backups are not transferred).

## 0.2.2

- Phone: narrower line-number column (from 82 to 51 px on an iPhone).
- With word wrap, the continuation of a long line stays aligned with its indentation.

## 0.2.1

- Read-only system folders (`.storage`, `.cloud`, `deps`, `tts`, `.git`) are hidden in the tree; the eye-shaped button shows them. The choice is remembered.

## 0.2.0

- Graphical interface: file tree, tabs, CodeMirror 6 editor, toolbar and status bar.
- Real-time YAML validation that recognises `!include`, `!secret` and the other Home Assistant tags.
- Context menu with new file, new folder, rename, delete and copy path.
- Warning for unsaved changes and handling of files changed outside Editha.
- Automatic, light or dark theme; open tabs and theme restored when you come back.
- Usable from a phone too: the tree becomes a side panel.
- Browser tests for each issue reported on File Editor Plus (#4–#19).

## 0.1.0

- Server (TypeScript, Fastify) reachable only through the Ingress proxy.
- File API for `/config`: list, read, save, create, rename, delete.
- Atomic save with conflict detection; copy of the previous version in `/data/backups`.
- `.storage`, `.cloud`, `deps`, `tts`, `.git` folders read-only.
- Temporary page in the panel: the editor arrives in the next version.

## 0.0.1

- Initial add-on structure (not installable).
