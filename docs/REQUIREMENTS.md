# Editha – requisiti

Every Day I Tweak HA. Add-on per Home Assistant che offre un
editor/IDE per i file di `/config`.

Stato: **concordato** (ottobre 2026). Le modifiche successive passano da questo documento.

## Principi

- Scritto da zero. File Editor Plus (FEP) è solo un riferimento per le funzionalità:
  non ha licenza, quindi niente codice, asset o testi copiati.
- Editor basato su CodeMirror 6: undo/redo, Tab, indentazione, guide, evidenziazione e
  ricerca vengono dalle sue estensioni, non da implementazioni fatte a mano.
- Backend raggiungibile solo via Ingress e confinato a `/config`.
- Moduli piccoli con una responsabilità ciascuno; la logica che tocca il filesystem o le
  API di HA sta nel backend e ha test.

## Priorità

| Livello | Significato |
| --- | --- |
| **P0** | Indispensabile per la prima versione utilizzabile (MVP). |
| **P1** | Necessario per la 1.0. |
| **P2** | Utile, da pianificare dopo la 1.0. |
| **—** | Fuori ambito (motivato). |

Gli ID (`SEC-1`, `ED-3`, …) servono per citarli nelle issue e nei commit.

---

## 1. Sicurezza e backend

| ID | Requisito | Pr. |
| --- | --- | --- |
| SEC-1 | Nessuna porta esposta: il server ascolta solo sulla porta Ingress e accetta richieste solo dal proxy Ingress del Supervisor (`172.30.32.2`). | P0 |
| SEC-2 | Ogni percorso ricevuto è risolto (incluso `realpath` per i symlink) e rifiutato se esce da `/config`. Niente `..`, percorsi assoluti esterni, byte nulli. | P0 |
| SEC-3 | Scrittura atomica: file temporaneo nella stessa cartella + `rename`, preservando permessi. Un salvataggio interrotto non lascia mai un file troncato. | P0 |
| SEC-4 | Rilevamento conflitti: il client invia l'hash/mtime letto; se il file è cambiato su disco nel frattempo il backend risponde 409 e l'UI chiede cosa fare (sovrascrivi / ricarica / confronta). | P0 |
| SEC-5 | Limiti: dimensione massima apribile nell'editor (configurabile), rilevamento file binari (aperti in sola lettura o solo scaricabili). | P0 |
| SEC-6 | Il token del Supervisor non arriva mai al browser; le chiamate a Core passano dal backend. | P0 |
| SEC-7 | `secrets.yaml`: modificabile, ma i valori non finiscono nei log né nelle risposte dell'autocompletamento (solo le chiavi). | P0 |
| SEC-8 | Cartelle delicate (`.storage`, `.cloud`, `deps`, `tts`, `.git`) nascoste nell'albero per default, visibili con un pulsante (scelta memorizzata) e sempre in sola lettura; sblocco esplicito della scrittura da valutare. | P1 |
| SEC-9 | Log del backend senza contenuto dei file. | P0 |

## 2. Esplora file

| ID | Requisito | Pr. |
| --- | --- | --- |
| FS-1 | Albero di `/config` con caricamento pigro delle cartelle e ordinamento cartelle → file; l'albero scorre indipendentemente dall'editor anche con molti file, con mouse e tastiera (FEP #4). | P0 |
| FS-2 | Crea file e cartella dai pulsanti sopra l'albero e dal menu contestuale (tasto destro). La destinazione è la cartella selezionata, anche se vuota (o la cartella del file selezionato); l'albero si aggiorna e il nuovo file si apre (FEP #11, #12). | P0 |
| FS-3 | **Rinomina** file e cartelle, sia dalla barra superiore sia dal menu contestuale, aggiornando le tab aperte sul percorso vecchio (FEP #18). | P0 |
| FS-4 | Elimina con conferma; il file eliminato finisce nei backup di Editha (BK-1), non sparisce. | P0 |
| FS-5 | Sposta con la voce "Sposta in…" del menu contestuale (niente trascinamento: troppo facile sbagliare), con aggiornamento delle tab aperte. | P1 |
| FS-6 | Upload dal PC (anche trascinando i file) e download sul PC; download di una cartella come zip. | P1 |
| FS-7 | Filtro per nome nell'albero; aggiornamento dell'albero quando i file cambiano su disco. | P1 |
| FS-8 | Duplica file e cartelle dal menu contestuale, con nome proposto da confermare. | P1 |
| FS-9 | Elenco di esclusioni configurabile (pattern glob). | P2 |
| FS-10 | Anteprima di immagini (PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, SVG) e PDF al posto dell'editor, con dimensioni e grandezza reale; gli SVG non possono eseguire script. | P1 |

## 3. Editor

| ID | Requisito | Pr. |
| --- | --- | --- |
| ED-1 | CodeMirror 6 con: undo/redo che annulla anche le indentazioni fatte con Tab, senza errori; Tab/Shift-Tab su una selezione indenta il blocco (mai lo cancella); indentazione automatica, guide di indentazione, numeri di riga, evidenziazione delle parentesi, folding (FEP #8, #9, #14). | P0 |
| ED-2 | Modalità per YAML, JSON, Python, JavaScript, CSS, Markdown, Jinja; testo semplice per il resto. | P0 |
| ED-3 | Più tab: indicatore di modifiche non salvate, stato (undo, cursore, scroll) conservato per tab, chiusura del file con pulsante e scorciatoia. La tab attiva e quella inattiva sono chiaramente distinguibili in entrambi i temi, con lo stesso linguaggio visivo della barra degli strumenti (FEP #15). | P0 |
| ED-4 | **Chiudendo la tab attiva si attiva la tab adiacente e l'editor mostra il suo contenuto**; chiudendo l'ultima si mostra lo stato vuoto. "Salva" scrive sempre il contenuto della tab attiva nel suo file, mai quello di un'altra tab (FEP #19). Coperto da test e2e. | P0 |
| ED-5 | Salvataggio con Ctrl/Cmd+S e pulsante; "salva tutto". | P0 |
| ED-6 | Avviso prima di chiudere una tab o la pagina con modifiche non salvate (FEP #10). | P0 |
| ED-7 | Trova/sostituisci nel file (estensione `search` di CM6). | P0 |
| ED-8 | Tema Auto (segue HA) / Chiaro / Scuro; la scelta resta memorizzata uscendo e rientrando nell'add-on (CFG-1, FEP #6). In entrambi i temi il testo selezionato resta leggibile, senza caratteri sovrapposti, su Chrome, Firefox, Safari e app di HA (FEP #7). | P0 |
| ED-9 | Avviso quando il file aperto cambia su disco (vedi SEC-4), con ricarica. | P1 |
| ED-10 | A capo automatico, dimensione carattere, spazi per indentazione: impostazioni per utente. | P1 |
| ED-11 | Uscendo dall'add-on (o al riavvio) e rientrando si ritrovano le tab aperte, con la stessa tab attiva e la posizione del cursore (FEP #13). | P0 |
| ED-14 | Le modifiche non salvate sopravvivono alla chiusura della pagina come bozza, che si può recuperare o scartare alla riapertura (FEP #13). | P1 |
| ED-15 | L'editor occupa tutta l'altezza disponibile e scorre fino all'ultima riga di qualsiasi file (FEP #15). | P0 |
| ED-16 | Controllo ortografico, correzione automatica e traduzione del browser disattivati nell'editor: le uniche sottolineature sono quelle del validatore (FEP #5). | P0 |
| ED-12 | Palette dei comandi e scorciatoie elencate in un aiuto. | P2 |
| ED-13 | Minimappa. | P2 |
| ED-17 | Vista divisa in due colonne: due file (o due punti dello stesso file) affiancati. | P1 |

## 4. YAML e Home Assistant

| ID | Requisito | Pr. |
| --- | --- | --- |
| HA-1 | Validazione YAML in tempo reale (sintassi) che riconosce i tag di HA: `!include`, `!include_dir_*`, `!secret`, `!input`, `!env_var`. Errori sottolineati nel punto esatto (riga e colonna) con messaggio; nessuna segnalazione su codice corretto; la sottolineatura si aggiorna/scompare mentre si corregge (FEP #5). | P0 |
| HA-2 | Autocompletamento degli `entity_id` dagli stati di Core, con nome e stato nel suggerimento. | P0 |
| HA-3 | Autocompletamento di servizi/azioni (`domain.service`) e dei loro campi. | P1 |
| HA-4 | Autocompletamento delle chiavi di `!secret` da `secrets.yaml`. | P1 |
| HA-5 | Ctrl/Cmd+clic su `!include path` apre il file incluso. | P1 |
| HA-6 | Hover su un `entity_id`: stato e attributi correnti. | P2 |
| HA-7 | Anteprima dei template Jinja tramite l'API di rendering di Core. | P2 |
| HA-8 | Cache di entità/servizi aggiornata su richiesta e periodicamente (o via WebSocket `state_changed`). | P1 |
| HA-9 | Controllo con spiegazioni concrete (righe coinvolte, rientro atteso) e avvisi per errori tipici di HA che restano YAML valido: `on`/`off`/`yes`/`no` senza virgolette, `chiave:valore` senza spazio, rientri dispari. Elenco dei problemi con riga e collegamento. | P1 |
| HA-10 | Autocompletamento delle icone Material Design dopo `mdi:`, con anteprima. | P1 |

## 5. Azioni su Home Assistant

| ID | Requisito | Pr. |
| --- | --- | --- |
| ACT-1 | Verifica della configurazione con risultato leggibile (errori con file e riga quando HA li fornisce). | P0 |
| ACT-2 | Ricarica mirata: menu con i domini ricaricabili (automazioni, script, scene, gruppi, template, `input_*`, core config, …) ricavati dai servizi `reload` disponibili. La ricarica deve avere effetto come l'equivalente in Strumenti per sviluppatori e l'esito mostrato è quello reale restituito da HA, non un "avviato" a prescindere (FEP #16). Utile solo per non interrompere le automazioni in corso quando si ricarica altro: "ricarica tutto lo YAML" basta nella maggior parte dei casi. | P2 |
| ACT-3 | Suggerimento della ricarica giusta in base al file salvato (es. `automations.yaml` → `automation.reload`). | P2 |
| ACT-4 | Riavvio di HA con conferma, preceduto obbligatoriamente da ACT-1: se la verifica fallisce il riavvio è bloccato. | P1 |
| ACT-5 | Visualizzazione del log di Core (ultime righe, filtro). | P2 |

## 6. Backup, confronto e ripristino

| ID | Requisito | Pr. |
| --- | --- | --- |
| BK-1 | Prima di ogni salvataggio, eliminazione o rinomina Editha conserva la versione precedente del file. | P0 |
| BK-2 | Elenco delle versioni di un file (data, dimensione). | P1 |
| BK-3 | Confronto affiancato versione ↔ attuale (merge view di CM6), anche per il conflitto di SEC-4. | P1 |
| BK-4 | Ripristino di una versione (a sua volta crea una versione, quindi è annullabile). | P1 |
| BK-5 | Politica di conservazione: 10 versioni per file (configurabile con `EDITHA_BACKUP_KEEP`). | P1 |
| BK-6 | Confronto tra due file qualsiasi. | P2 |
| BK-7 | Backup completi di HA tramite Supervisor (crea/elenca). | P2 |

## 7. Ricerca

| ID | Requisito | Pr. |
| --- | --- | --- |
| SR-1 | Ricerca testuale in tutti i file (rispettando esclusioni e limiti), risultati cliccabili alla riga. | P1 |
| SR-2 | Espressioni regolari e distinzione maiuscole/minuscole. | P1 |
| SR-3 | Sostituisci in più file (con anteprima e backup BK-1). | P2 |
| SR-4 | "Trova riferimenti" di un `entity_id` in tutta la configurazione. | P2 |

## 8. Impostazioni

| ID | Requisito | Pr. |
| --- | --- | --- |
| CFG-1 | Le impostazioni di Editha hanno un'unica fonte (backend, in `/data`), si applicano subito senza ricaricare la pagina e sopravvivono al riavvio dell'add-on. | P0 |
| CFG-2 | Le opzioni dell'add-on nel pannello di HA si limitano a quelle che servono prima dell'avvio (es. livello di log); il resto sta nelle impostazioni dell'UI. | P1 |

## 9. Interfaccia

| ID | Requisito | Pr. |
| --- | --- | --- |
| UI-1 | Layout: albero a sinistra (ridimensionabile e richiudibile), tab ed editor al centro, barra di stato (percorso, posizione cursore, esito validazione). | P0 |
| UI-2 | Utilizzabile da tablet e dall'app mobile di HA (albero come pannello a scomparsa). | P1 |
| UI-3 | Interfaccia in italiano e inglese, con selettore; "Automatica" segue la lingua del browser. | P1 |
| UI-4 | Notifiche non bloccanti per esiti (salvato, verifica ok/ko, ricarica eseguita). | P0 |
| UI-5 | Accessibilità di base: navigazione da tastiera nell'albero e nelle tab. | P2 |
| UI-6 | La barra degli strumenti agisce sempre sulla tab attiva; i pulsanti hanno stato coerente (es. "Salva" disabilitato se non ci sono modifiche) e lo stesso stile di attivo/inattivo delle tab (FEP #15). | P0 |
| UI-8 | Finestra "Informazioni": autore, repository, versione, licenza, riconoscimenti. | P2 |
| UI-7 | "Copia tutto" nella barra o nel menu contestuale dell'editor (FEP #15). | P2 |

## 10. Ingegneria

| ID | Requisito | Pr. |
| --- | --- | --- |
| ENG-1 | Moduli piccoli e separati (vedi struttura proposta sotto); nessun file "tuttofare". | P0 |
| ENG-2 | Test unitari del backend, in particolare confinamento dei percorsi (SEC-2) e scrittura atomica (SEC-3). | P0 |
| ENG-3 | Test e2e (Playwright) dei flussi principali, incluso ED-4. | P1 |
| ENG-4 | CI su GitHub Actions: lint, test, build dell'immagine per `amd64` e `aarch64`. | P0 |
| ENG-7 | L'aggiornamento dell'add-on non deve poter fallire in fase di build sul dispositivo: il frontend si compila in uno stage indipendente dall'architettura (o in CI) e l'immagine finale contiene solo i file già compilati; nessuna dipendenza nativa legata a musl/glibc nel frontend. Verificato su `aarch64` prima di ogni rilascio (FEP #17). | P0 |
| ENG-5 | Versionamento semantico, `CHANGELOG.md` aggiornato a ogni rilascio. | P0 |
| ENG-6 | Immagine leggera basata sulle base image di HA; asset del frontend compilati in fase di build, nessun download a runtime. | P0 |

## Fuori ambito (per ora)

- **Terminale**: c'è già l'add-on SSH/Terminal; aggiungerlo amplierebbe molto la superficie d'attacco.
- **Git integrato**: valutabile dopo la 1.0.
- **Accesso fuori da `/config`** (`/share`, `/media`, `/addons`, `/ssl`): eventualmente come opzione futura, una cartella alla volta.

---

## Struttura del repository

Attuale:

```
repository.yaml          metadati della raccolta
README.md
LICENSE                  MIT
.github/workflows/       test, test nel browser e build per amd64/aarch64 (ENG-3, ENG-4)
docs/
  REQUIREMENTS.md        questo documento
  DEVELOPMENT.md         come provare il codice, API del server
editha/
  config.yaml            manifest dell'add-on (ingress, /config, homeassistant_api)
  build.yaml, Dockerfile immagine: compilazione di server e interfaccia + runtime Node.js
  icon.png, logo.png
  README.md, DOCS.md, CHANGELOG.md
  server/
    src/
      main.ts, app.ts    avvio e composizione
      config.ts          variabili d'ambiente
      errors.ts          errori con codice stabile
      security/          filtro Ingress (SEC-1)
      fs/                percorsi (SEC-2), scrittura atomica (SEC-3), file (FS-*)
      backups/           versioni dei file (BK-*)
      state/             impostazioni (CFG-1) e sessione (ED-11) in /data
      routes/            un file per gruppo di endpoint, interfaccia compilata
    test/
  web/
    public/index.html    pagina e colori dei temi (variabili CSS)
    build.mjs            bundle con esbuild-wasm, senza binari nativi
    src/
      api/               client e tipi condivisi con il server
      state/             tab (ED-3, ED-4) e percorsi, logica senza DOM
      editor/            setup CodeMirror, tema, linguaggi, validatore YAML
      components/        app, barra strumenti, albero, tab, editor, barra di stato, dialoghi, menu, notifiche
      ui/                icone e stili comuni
    test/                test unitari
    e2e/                 test nel browser (Playwright), uno per ogni issue di FEP
```

Da aggiungere:

```
editha/
  translations/{en,it}.yaml
  server/src/ha/         chiamate a Core via Supervisor (HA-2, ACT-*)
  web/src/i18n/          interfaccia in inglese (UI-3)
```

---

## Avanzamento

| Versione | Requisiti coperti |
| --- | --- |
| 0.1.0 | SEC-1, SEC-2, SEC-3, SEC-4, SEC-5, SEC-6 (nessun token esposto), SEC-9, ENG-1, ENG-2, ENG-4, ENG-6, ENG-7; lato server: FS-2, FS-3, FS-4, BK-1, BK-2, BK-5 (limite fisso di 50 versioni), SEC-8 (senza sblocco). |
| 0.2.0 | Interfaccia: FS-1, FS-2, FS-3, FS-4, FS-7 (filtro per nome), ED-1…ED-8, ED-10 (solo a capo automatico), ED-11, ED-15, ED-16, HA-1, CFG-1, UI-1, UI-2, UI-4, UI-5 (tastiera nell'albero), UI-6, ENG-3. P0 ancora da fare: HA-2 (autocompletamento entità), ACT-1 (verifica della configurazione). |
| 0.2.1 | SEC-8: cartelle di sistema nascoste per default, pulsante per mostrarle. |
| 0.2.2 | UI-2: colonna dei numeri compatta su telefono, righe spezzate allineate all'indentazione. |
| 0.3.0 | Nuovo nome: Editha (D10). |
| 0.3.1 | Descrizione: solo "Easy Developer IDE for The HA". |
| 0.4.0 | HA-2, HA-3 (autocompletamento entità e azioni), ACT-1, ACT-2 (ricarica di tutto lo YAML), ACT-4, snippet predefiniti e personali; colonna dei numeri compatta. |
| 0.4.1 | Avviso di connessione persa / add-on aggiornato con ricarica della pagina; ritentativo delle letture. |
| 0.4.2 | Correzione token del Supervisor con s6-overlay (HA-2, ACT-* nell'add-on reale); carattere 13/14 px; aggiornamenti senza refresh forzato. |
| 0.5.0 | UI-3: interfaccia in italiano e inglese con selettore (automatica dal browser). |
| 0.6.0 | FS-6: upload dal PC (pulsante, menu, trascinamento) e download (file, cartella come zip). |
| 0.7.0 | BK-2, BK-3, BK-4: cronologia con confronto e ripristino; BK-5: 10 versioni per file; FS-8: duplica; menu contestuale con pressione prolungata su telefono. |
| 0.7.1 | UI-2: pulsante per chiudere la tastiera su iPhone; FS-8 più sicuro (copie YAML in .bak). |
| 0.8.0 | ED-14: bozze delle modifiche non salvate, recuperabili alla riapertura. |
| 0.8.1 | UI-2: niente effetto elastico di iOS sull'editor. |
| 0.9.0 | ED-17: vista divisa in due colonne; finestra Informazioni. |
| 0.10.0 | HA-9: spiegazioni degli errori di indentazione, avvisi per gli errori tipici di HA, elenco dei problemi. |
| 0.11.0 | HA-4 (chiavi di !secret), HA-5 (Ctrl+clic su !include, !include_dir_…, !secret). |
| 0.12.0 | FS-5: "Sposta in…" dal menu contestuale. |
| 0.13.0 | SR-1, SR-2 (ricerca in tutti i file, regex, maiuscole, parola intera), SR-4 (dove è usata un'entità). ACT-2 mirata tolta dalla lista (non serve). |
| 0.13.1 | Correzioni della revisione generale del codice. |
| 0.13.2 | Pulsante "chiudi la tastiera" accanto al cursore; secrets.yaml escluso dalla ricerca. |
| 0.14.0 | HA-10: autocompletamento delle icone MDI con anteprima. |
| 0.15.0 | SR-3: sostituisci in più file, con conferma e cronologia. |
| 0.16.0 | BK-6: confronto tra due file qualsiasi. Icona del pannello: mdi:pencil-circle-outline (0.16.1: mdi:pencil). |
| 0.17.0 | Modifica degli snippet personali. |
| 0.17.1 | Nome EDITHA in maiuscolo nell'interfaccia, motto "Every Day I Tweak HA"; tolta la scritta "Esplora file" sopra l'albero. |
| 0.17.2 | Su telefono nella barra solo il nome EDITHA, senza logo. |
| 0.18.0 | Documentazione utente (DOCS.md, DOCS.it.md) con immagini; file per GitHub (CONTRIBUTING, SECURITY, modelli, release); HA-9: «chiave valore» senza due punti spiegato. |
| 0.18.1 | Nuovo file/cartella solo sopra l'albero (tolti dalla barra in alto). |
| 0.18.2 | Descrizione nel negozio: "Smart file editor for Home Assistant". |
| 0.19.0 | FS-10: anteprima di immagini e PDF. |

---

## Decisioni

| # | Decisione | Motivo |
| --- | --- | --- |
| D1 | Backend in **TypeScript** (Node.js). | Un solo linguaggio per backend e frontend, tipi dell'API condivisi, libreria `yaml` con supporto ai tag di HA. |
| D2 | Frontend con **Lit**. | Componenti piccoli e leggeri, stessa tecnologia del frontend di HA; CodeMirror 6 si integra senza adattatori. |
| D3 | Versioni dei file in **`/data/backups`**. | Fuori da `/config`, incluse nel backup dell'add-on. |
| D4 | Priorità alle **versioni dei singoli file** (BK-1…5); backup completi del Supervisor a P2 (BK-7). | |
| D5 | Il repository diventa **pubblico al primo rilascio**. | Il Supervisor deve poterlo clonare senza credenziali. |
| D7 | Architetture **`amd64`** e **`aarch64`**. | HA ha deprecato le architetture a 32 bit. |
| D9 | `.storage` e simili **nascoste per default** (proposta di Trizompa dopo la prima prova), visibili a richiesta e **in sola lettura** (SEC-8). | |
| D10 | Nome definitivo **Editha** (Easy Developer IDE for The HA; acronimo E.D.I.T.H.A. abbandonato), slug `editha`. | Scelta di Trizompa dopo la prima installazione. |
| D6 | Licenza **MIT**. | Semplice e diffusa tra gli add-on di HA. |
| D8 | Le issue di FEP #4–#19 sono coperte dai requisiti (vedi tabella sotto). | |

### Issue di File Editor Plus → requisiti

Riferimento solo per comportamento atteso e problemi riscontrati; nessun codice di FEP.

| FEP | Problema | Requisito |
| --- | --- | --- |
| #4 | L'albero dei file non scorre, si vedono solo due elementi | FS-1 |
| #5 | Sottolineature rosse su codice corretto dopo un clic (probabile controllo ortografico del browser) | ED-16, HA-1 |
| #6 | Il tema scelto torna su "Auto" uscendo e rientrando | ED-8, CFG-1 |
| #7 | Testo selezionato illeggibile (caratteri sovrapposti), peggio su Chrome | ED-8 |
| #8 | Tab su una selezione cancella il testo; poi Ctrl+Z dà errore | ED-1 |
| #9 | Mancano le guide di indentazione | ED-1 |
| #10 | Nessun avviso chiudendo un file con modifiche non salvate | ED-6 |
| #11 | "Nuovo file/cartella" crea nella radice ignorando la cartella selezionata; impossibile nelle cartelle vuote | FS-2 |
| #12 | "Nuovo file/cartella" assenti dal menu contestuale | FS-2 |
| #13 | Uscendo dall'add-on si perdono le tab aperte (il File Editor di HA ricorda l'ultimo file) | ED-11, ED-14 |
| #14 | Undo non annulla l'indentazione fatta con Tab | ED-1 |
| #15 | Tab attive/inattive con colori opposti alla toolbar e poco distinguibili; righe oltre la 40 non visibili; richiesta "Copia tutto" | ED-3, UI-6, ED-15, UI-7 |
| #16 | "Reload YAML" dice "avviato" ma non ricarica nulla | ACT-2 |
| #17 | Aggiornamento fallito su `aarch64`: build del frontend sul dispositivo senza il modulo nativo di Rollup per musl | ENG-7 |
| #18 | Manca "Rinomina" per file e cartelle, sia nella barra sia nel menu contestuale | FS-3 |
| #19 | Chiusa la tab attiva, l'editor mostra ancora il file chiuso; "Salva" rischia di scrivere il contenuto sbagliato | ED-4 |
