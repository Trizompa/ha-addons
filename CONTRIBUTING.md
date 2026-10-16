# Contributing

Thanks for wanting to help EDITHA. Bug reports and ideas are the most useful contribution:
[open an issue](https://github.com/Trizompa/ha-addons/issues/new/choose) and pick the right form.

## Before opening a pull request

Open an issue first for anything bigger than a small fix, so we can agree on the approach.
EDITHA tries to do a few things very well: a feature that adds risk or complexity for little gain
may be declined even if it works.

## Development setup

You need Node.js 22. The add-on has two parts:

| Folder | What | Stack |
| --- | --- | --- |
| `editha/server` | Backend: files, history, Home Assistant API | TypeScript, Fastify |
| `editha/web` | Interface | TypeScript, Lit, CodeMirror 6, esbuild |

```sh
npm ci --prefix editha/server
npm ci --prefix editha/web

# Server: type check and unit tests
npm --prefix editha/server run typecheck
npm --prefix editha/server test

# Interface: type check, unit tests and browser tests (Playwright, Chromium)
cd editha/web
npm run typecheck
npm test
npx playwright install chromium   # once
npm run test:e2e
```

[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) explains how to run EDITHA on a local folder, the
environment variables and the HTTP API. [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) lists the
requirements and the design decisions (both in Italian).

## Guidelines

- Keep modules small and focused, and match the style of the surrounding code.
- Every change to the behaviour needs a test: unit tests for logic, a Playwright test for user
  flows.
- Safety rules are not negotiable: paths stay inside `/config`, saves are atomic, secret values
  never reach the browser, system folders stay read-only.
- New interface text goes in both `editha/web/src/i18n/en.ts` and `it.ts`.
- Bump `version` in `editha/config.yaml` and add an entry to `editha/CHANGELOG.md` for every
  change users can see.
- CI must be green: it runs the tests and builds the image for `amd64` and `aarch64`.

## Screenshots

The images in `docs/images` are generated:

```sh
cd editha/web
npm run build && npm --prefix ../server run build
node scripts/screenshots.mjs
python3 scripts/optimize-images.py   # optional, needs Pillow
```

By contributing you agree that your work is released under the [MIT license](LICENSE).
