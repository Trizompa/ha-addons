# Notes for Claude

## Publishing needs explicit consent

Never publish anything without the maintainer's explicit consent for that specific version,
given in words like "pubblica" / "publish". Approval of a mockup, a plan or an implementation
("ok", "mi piace", "sì, procedi") is NOT consent to publish. Do not infer it.

Publishing means any of these steps:
- running the **Publish images** workflow (it pushes images to ghcr.io);
- pushing or fast-forwarding `main` (Home Assistant users see the new version);
- running the **Release** workflow or pushing a `v*` tag.

Allowed without asking: implementing, running tests, committing and pushing to the work branch,
code review. When the work is ready, stop and ask whether to publish.

## Design choices are the maintainer's

Every point I propose or ask about needs its own clear answer from the maintainer before I
implement it. A point left unanswered is NOT approved: do not build it, ask again. This covers
features (e.g. a new menu), defaults and behaviour (what a click does, what is on or off) and
anything users will see.

A generic "sì" / "ok" / "vado" to a message with several points, or to a message that also talks
about something else, approves nothing: list the open points and ask for an answer on each one.
Never bundle a decision with another topic.

## Stay inside what was agreed

While a topic is still being discussed, do only what the maintainer approved, nothing around it.
Anything else (version bumps, changelog wording, other files, anything visible on GitHub) waits
for its own answer. Commit messages never mention issues or PRs (`#11`, "fixes #11"): GitHub
links them on the issue page, which is visible to others.
