# Come pubblicare una versione

Promemoria per il manutentore. Le voci con ☐ si fanno una volta sola, al primo rilascio pubblico
(1.0.0); le altre a ogni versione.

## A ogni versione

1. `version` in `editha/config.yaml` aumentata (MAJOR.MINOR.PATCH: PATCH per correzioni, MINOR per
   funzioni nuove, MAJOR per cambiamenti che rompono qualcosa).
2. Voce in `editha/CHANGELOG.md` con lo stesso numero (`## 1.0.0`).
3. Documentazione aggiornata se cambia qualcosa che l'utente vede (`editha/DOCS.md` e
   `editha/DOCS.it.md`). Se cambia l'aspetto, rigenerare le immagini (vedi CONTRIBUTING.md).
4. CI verde su GitHub.
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
- ☐ **Storia dei commit e privacy.** Rendendo pubblico il repository diventa pubblica anche tutta
  la storia: i commit vecchi contengono ancora il nome e cognome (nei file di allora) e un commit
  ha come autore il tuo indirizzo email. Due possibilità:
  - pubblicare così com'è (la storia racconta lo sviluppo, ma nome ed email restano visibili);
  - **consigliato**: pubblicare una storia pulita, cioè un `main` con un solo commit iniziale
    "EDITHA 1.0.0" che contiene lo stato finale. Il repository privato attuale può restare come
    archivio. Da fare con calma insieme, prima di cambiare la visibilità.
  - In ogni caso, su GitHub: **Settings → Emails → Keep my email addresses private**, così i
    commit futuri fatti dal sito usano l'indirizzo `noreply`.
- ☐ **Rendere pubblico**: Settings → General → Danger Zone → *Change repository visibility*.
- ☐ **Sicurezza**: Settings → Code security → attivare *Private vulnerability reporting* (serve
  per SECURITY.md) e *Dependabot alerts*.
- ☐ **Presentazione del repository** (rotella accanto ad *About* nella pagina principale):
  - descrizione: `EDITHA – Every Day I Tweak HA. The Home Assistant configuration editor add-on.`
  - topics: `home-assistant`, `home-assistant-addon`, `hassio-addon`, `yaml`, `editor`,
    `codemirror`
  - Settings → General → *Social preview*: caricare `docs/images/cover.png` (è l'immagine che
    compare quando il link viene condiviso).
- ☐ **Protezione di `main`** (dopo averlo reso pubblico): Settings → Rules → Rulesets → *New
  branch ruleset*, destinazione *Default branch*, con *Restrict deletions*, *Block force pushes*
  e *Require status checks to pass* (i controlli "Test del server", "Test dell'interfaccia",
  "Build amd64", "Build aarch64").
- ☐ **Etichette** per le segnalazioni: `bug` ed `enhancement` esistono già di default.
- ☐ Tag `v1.0.0` e release (vedi sopra).
- ☐ **Il tuo Home Assistant.** Oggi l'add-on arriva dal mirror Forgejo, branch di sviluppo. Per
  Home Assistant un repository (o branch) diverso è un add-on diverso: passando all'indirizzo
  GitHub pubblico si installa un EDITHA "nuovo", e cronologia dei file, snippet personali e
  impostazioni del vecchio non vengono trasferiti. I file di `/config` naturalmente restano.
  Prima di disinstallare il vecchio, copia a mano gli snippet personali che vuoi tenere.
- ☐ **Annuncio** (facoltativo): forum di Home Assistant, categoria *Share your Projects*, e
  r/homeassistant, con l'immagine `docs/images/cover.png` e il link al repository.

## Più avanti (facoltativo)

- **Immagini già pronte su GitHub (GHCR)**: oggi Home Assistant costruisce l'add-on sul
  dispositivo a ogni installazione o aggiornamento (qualche minuto su un Raspberry). Pubblicando le
  immagini già costruite, l'aggiornamento diventa un semplice download. Richiede un workflow in
  più e la riga `image:` in `config.yaml`.
- **CHANGELOG in inglese** dalla 1.0.0, se il pubblico diventa internazionale (Home Assistant lo
  mostra nella finestra di aggiornamento).
