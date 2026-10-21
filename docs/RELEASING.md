# Come pubblicare una versione

Promemoria per il manutentore. Le voci con ☐ si fanno una volta sola, al primo rilascio pubblico
(1.0.0); le altre a ogni versione.

## A ogni versione

1. `version` in `editha/config.yaml` aumentata (MAJOR.MINOR.PATCH: PATCH per correzioni, MINOR per
   funzioni nuove, MAJOR per cambiamenti che rompono qualcosa).
2. Voce con lo stesso numero (`## 1.0.0`) in `editha/CHANGELOG.md` (inglese: è quella che Home
   Assistant mostra nella finestra di aggiornamento e che finisce nella release) e in
   `editha/CHANGELOG.it.md` (italiano).
3. Documentazione aggiornata se cambia qualcosa che l'utente vede (`editha/DOCS.md` e
   `editha/DOCS.it.md`). Se cambia l'aspetto, rigenerare le immagini (vedi CONTRIBUTING.md).
4. CI verde su GitHub. Se sono cambiati `Dockerfile`, `build.yaml` o le dipendenze, lanciare a
   mano anche la build aarch64 (Actions → Editha → Run workflow): è emulata e lenta, quindi non
   parte da sola.
5. Unione nel branch `main` (pull request).
6. Tag e release: su `main` creare il tag `v` + versione (es. `v1.0.0`) da **Releases → Draft a
   new release → Choose a tag**, oppure `git tag v1.0.0 && git push origin v1.0.0`. Il workflow
   *Release* controlla che il numero coincida con `config.yaml` e pubblica la release con il testo
   del CHANGELOG.

Home Assistant vede l'aggiornamento appena la versione in `config.yaml` su `main` cambia: il tag
serve solo alla pagina delle release su GitHub.

## Primo rilascio pubblico (1.0.0)

- ☐ **Prova sul campo** su PC e telefono; correzioni dei problemi trovati.
- ☐ In `editha/config.yaml` togliere `stage: experimental` (senza la riga l'add-on è considerato
  stabile) e portare `version` a `1.0.0`.
- ☐ Su GitHub: **Settings → Emails → Keep my email addresses private**, così i commit futuri
  fatti dal sito usano l'indirizzo `noreply`. (Nella storia non ci sono dati personali.)
- ☐ **Rendere pubblico**: Settings → General → Danger Zone → *Change repository visibility*.
- ☐ Immagini della documentazione: con il repository pubblico, nei link di `editha/DOCS.md`,
  `editha/DOCS.it.md` e `editha/README.md` sostituire `../docs/images/` con
  `https://raw.githubusercontent.com/Trizompa/ha-addons/main/docs/images/` (la scheda
  Documentazione di Home Assistant non risolve i percorsi relativi).
- ☐ **Sicurezza**: Settings → Code security → attivare *Private vulnerability reporting* (serve
  per SECURITY.md) e *Dependabot alerts*.
- ☐ **Presentazione del repository** (rotella accanto ad *About* nella pagina principale):
  - descrizione: `EDITHA – Every Day I Tweak HA. Smart file editor add-on for Home Assistant.`
  - topics: `home-assistant`, `home-assistant-addon`, `hassio-addon`, `yaml`, `editor`,
    `codemirror`
  - Settings → General → *Social preview*: caricare `docs/images/cover.png` (è l'immagine che
    compare quando il link viene condiviso).
- ☐ **Protezione di `main`** (dopo averlo reso pubblico): Settings → Rules → Rulesets → *New
  branch ruleset*, destinazione *Default branch*, con *Restrict deletions*, *Block force pushes*
  e *Require status checks to pass* (i controlli "Test del server", "Test dell'interfaccia",
  "Build amd64"; "Build aarch64" parte solo a mano, quindi non va messo tra quelli obbligatori).
- ☐ **Etichette** per le segnalazioni: `bug` ed `enhancement` esistono già di default.
- ☐ Tag `v1.0.0` e release (vedi sopra).
- ☐ **Annuncio** (facoltativo): forum di Home Assistant, categoria *Share your Projects*, e
  r/homeassistant, con l'immagine `docs/images/cover.png` e il link al repository.

## Più avanti (facoltativo)

- **Immagini già pronte su GitHub (GHCR)**: oggi Home Assistant costruisce l'add-on sul
  dispositivo a ogni installazione o aggiornamento (qualche minuto su un Raspberry). Pubblicando le
  immagini già costruite, l'aggiornamento diventa un semplice download. Richiede un workflow in
  più e la riga `image:` in `config.yaml`.
