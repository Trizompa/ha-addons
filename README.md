# Trizompa – Home Assistant add-ons

[![CI](https://github.com/Trizompa/ha-addons/actions/workflows/editha.yaml/badge.svg)](https://github.com/Trizompa/ha-addons/actions/workflows/editha.yaml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[![Add the repository to Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FTrizompa%2Fha-addons)

| Add-on | Description |
| --- | --- |
| [EDITHA](editha/) | Smart file editor for Home Assistant |

## EDITHA

![EDITHA on desktop and phone](docs/images/cover.png)

EDITHA is a file editor for your Home Assistant configuration. It opens from the sidebar and works
on a PC, a tablet or a phone. It explains YAML errors in plain words, suggests your entities,
actions and icons, checks the configuration before every restart and keeps the previous version
of every file you save.

| | |
| --- | --- |
| ![A YAML error explained](docs/images/problems.png) | ![Entity suggestions](docs/images/autocomplete-entities.png) |
| ![Search in all files](docs/images/search.png) | ![File history](docs/images/history.png) |

- 📖 [Documentation](editha/DOCS.md) · [Documentazione in italiano](editha/DOCS.it.md)
- 📝 [Changelog](editha/CHANGELOG.md)

## Installation

1. Press the button above, or in Home Assistant go to **Settings → Add-ons → Add-on store → ⋮ →
   Repositories** and add `https://github.com/Trizompa/ha-addons`.
2. Install **EDITHA**, start it and turn on **Show in sidebar**.

Requires Home Assistant OS or a Supervised installation (add-ons), on `amd64` or `aarch64`.

## Contributing

Bug reports and ideas are welcome: [open an issue](https://github.com/Trizompa/ha-addons/issues/new/choose).
To work on the code see [CONTRIBUTING.md](CONTRIBUTING.md); security problems go through
[SECURITY.md](SECURITY.md).

## Repository layout

```
repository.yaml      add-on repository metadata, read by the Supervisor
editha/              the EDITHA add-on (slug "editha")
docs/                requirements, development notes, release checklist, images
.github/             CI, release workflow, issue and pull request templates
```

## License

[MIT](LICENSE) © [Trizompa](https://github.com/Trizompa)
