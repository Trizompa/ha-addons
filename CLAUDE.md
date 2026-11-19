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

When a feature has a choice that changes how EDITHA behaves for users (defaults, what a click
does, what is on or off), propose the options and wait for the maintainer to pick one in clear
words. A "sì" to a message that also asks about something else is not a choice: ask one
question at a time and never bundle a design decision with another topic.
