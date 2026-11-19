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
