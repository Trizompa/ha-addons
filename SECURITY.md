# Security policy

EDITHA can read and write your Home Assistant configuration, so security reports are taken
seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting instead:
[Report a vulnerability](https://github.com/Trizompa/ha-addons/security/advisories/new).

Include what an attacker can do, the steps to reproduce and the EDITHA version. You will get an
answer within a week; a fix is released as soon as possible and credited to you if you wish.

## Supported versions

Only the latest release receives fixes. Update from the app page in Home Assistant.

## Design

- The server listens only to Home Assistant's Ingress proxy; no port is exposed.
- Every path is resolved (symbolic links included) and refused if it leaves `/config`.
- Saves are atomic and conflicts are detected; the previous version is kept.
- The Supervisor token and the values in `secrets.yaml` never reach the browser through the
  API, except when the user opens `secrets.yaml` itself.
- System folders (`.storage`, `.cloud`, `deps`, `tts`, `.git`) are read-only.
- `secrets.yaml` and its copies are never searched or replaced, never put in a folder ZIP and
  never committed from the Git panel.
- Git works only on the local repository in `/config`: there is no push, pull or fetch, and
  network protocols, hooks, filters, signing and external programs are disabled for every Git
  command EDITHA runs.
