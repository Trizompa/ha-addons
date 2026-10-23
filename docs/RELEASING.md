# How to publish a version

Reminder for the maintainer. Items marked ☐ are done only once, at the first public release
(1.0.0); the others at every version.

## At every version

1. `version` in `editha/config.yaml` bumped (MAJOR.MINOR.PATCH: PATCH for fixes, MINOR for new
   features, MAJOR for breaking changes).
2. Entry with the same number (`## 1.0.0`) in `editha/CHANGELOG.md` (English: it is the one Home
   Assistant shows in the update dialog and that goes into the release) and in
   `editha/CHANGELOG.it.md` (Italian).
3. Documentation updated if something the user sees changes (`editha/DOCS.md` and
   `editha/DOCS.it.md`). If the look changes, regenerate the images (see CONTRIBUTING.md).
4. CI green on GitHub (tests and both image builds).
5. **Ready-made images**: on the branch that carries the new version, run **Actions → Publish
   images → Run workflow** and wait until both jobs are green. It publishes
   `ghcr.io/trizompa/{amd64,aarch64}-addon-editha:<version>`. This must happen BEFORE the
   version reaches `main`: Home Assistant downloads the image of the version it reads in
   `config.yaml`, and the install or update fails if that image does not exist yet.
6. Merge into the `main` branch (pull request or fast-forward).
7. Tag and release: on `main` create the tag `v` + version (e.g. `v1.0.0`) from **Releases → Draft
   a new release → Choose a tag**, or `git tag v1.0.0 && git push origin v1.0.0`. The *Release*
   workflow checks that the number matches `config.yaml` and publishes the release with the
   CHANGELOG text.

Home Assistant sees the update as soon as the version in `config.yaml` on `main` changes: the
tag is only for the releases page on GitHub.

## First public release (1.0.0)

- ☐ **Field test** on PC and phone; fix the problems found.
- ☐ In `editha/config.yaml` remove `stage: experimental` (without the line the app is
  considered stable) and set `version` to `1.0.0`.
- ☐ On GitHub: **Settings → Emails → Keep my email addresses private**, so future commits made
  from the website use the `noreply` address. (The history contains no personal data.)
- ☐ **Make public**: Settings → General → Danger Zone → *Change repository visibility*.
- ☐ **Images public**: after the first run of *Publish images*, on GitHub open your profile →
  **Packages** → `amd64-addon-editha` and `aarch64-addon-editha` → **Package settings → Change
  visibility → Public** (once per package; otherwise Home Assistant cannot download them).
- ☐ **Security**: Settings → Code security → enable *Private vulnerability reporting* (needed
  for SECURITY.md) and *Dependabot alerts*.
- ☐ **Repository presentation** (gear next to *About* on the main page):
  - description: `EDITHA – Every Day I Tweak HA. Smart file editor app for Home Assistant.`
  - topics: `home-assistant`, `home-assistant-addon`, `hassio-addon`, `yaml`, `editor`,
    `codemirror`
  - Settings → General → *Social preview*: upload `docs/images/cover.png` (the image shown when
    the link is shared).
- ☐ **Protect `main`** (after making it public): Settings → Rules → Rulesets → *New branch
  ruleset*, target *Default branch*, with *Restrict deletions*, *Block force pushes* and
  *Require status checks to pass* (the checks "Server tests", "Web tests", "Build amd64",
  "Build aarch64").
- ☐ **Labels** for issues: `bug` and `enhancement` already exist by default.
- ☐ Tag `v1.0.0` and release (see above).
- ☐ **Announcement** (optional): Home Assistant forum, *Share your Projects* category, and
  r/homeassistant, with the image `docs/images/cover.png` and the link to the repository.

## Later (optional)

- **Prebuilt images on GitHub (GHCR)**: today Home Assistant builds the app on the device at
  every install or update (a few minutes on a Raspberry). By publishing prebuilt images, an
  update becomes a simple download. Requires one more workflow and the `image:` line in
  `config.yaml`.
