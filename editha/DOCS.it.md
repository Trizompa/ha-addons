# EDITHA

*Every Day I Tweak HA*

![EDITHA su computer e telefono](../docs/images/cover.png)

EDITHA è un editor di file per la configurazione di Home Assistant. È un add-on: si apre dalla
barra laterale e funziona su PC, tablet e telefono. Conosce Home Assistant: spiega gli errori YAML
a parole, suggerisce entità, azioni e icone, e verifica la configurazione prima di ogni riavvio.
A ogni salvataggio conserva la versione precedente, così si può sempre tornare indietro.

*English documentation: [DOCS.md](DOCS.md).* Le immagini mostrano l'interfaccia in inglese;
EDITHA è anche in italiano (pulsante della lingua in alto a destra).

## Indice

- [Installazione](#installazione)
- [La finestra in breve](#la-finestra-in-breve)
- [File e cartelle](#file-e-cartelle)
- [Modificare i file](#modificare-i-file)
- [Aiuti per Home Assistant](#aiuti-per-home-assistant)
- [Cerca e sostituisci in tutti i file](#cerca-e-sostituisci-in-tutti-i-file)
- [Cronologia e confronto](#cronologia-e-confronto)
- [Telefono e tablet](#telefono-e-tablet)
- [Scorciatoie da tastiera](#scorciatoie-da-tastiera)
- [Sicurezza e privacy](#sicurezza-e-privacy)
- [Problemi frequenti](#problemi-frequenti)

## Installazione

1. Aggiungi il repository a Home Assistant con questo pulsante, oppure a mano da
   **Impostazioni → Componenti aggiuntivi → Negozio → ⋮ → Repository** con l'indirizzo
   `https://github.com/Trizompa/ha-addons`.

   [![Aggiungi il repository a Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FTrizompa%2Fha-addons)

2. Apri **EDITHA** nel negozio e premi **Installa**.
3. Premi **Avvia**, poi attiva **Mostra nella barra laterale**.
4. Apri EDITHA dalla barra laterale (icona a matita).

Non c'è niente da configurare. EDITHA non ha opzioni e non apre porte: si raggiunge solo
attraverso Home Assistant (Ingress), con il tuo accesso a Home Assistant.

## La finestra in breve

![Finestra principale](../docs/images/main-dark.png)

- **Barra degli strumenti** (in alto): esplora file, salva e salva tutto,
  annulla e ripeti, cerca, cronologia del file, a capo automatico, vista divisa, schema, pannello Inserisci
  e menu di Home Assistant. A destra: lingua (italiano o inglese), tema (automatico, chiaro, scuro)
  e Informazioni.
- **Esplora file** (a sinistra): il contenuto di `/config`. Sopra: cerca in tutti i file, nuovo
  file, nuova cartella, cartelle di sistema, carica, aggiorna e comprimi tutto.
- **Tab ed editor** (al centro): una tab per ogni file aperto. Il pallino su una tab indica
  modifiche non salvate.
- **Barra di stato** (in basso): percorso del file, esito del controllo YAML, posizione del
  cursore, codifica e linguaggio.

Tab aperte, tab attiva, tema e lingua restano memorizzati quando esci da EDITHA o riavvii
l'add-on.

![Tema chiaro](../docs/images/main-light.png)

## File e cartelle

Tasto destro su un file o una cartella (pressione prolungata sul telefono) apre il menu:

| Azione | Note |
| --- | --- |
| Nuovo file / Nuova cartella | Creati dentro la cartella selezionata. |
| Rinomina (F2) | Le tab aperte seguono il nuovo nome. |
| Duplica… | Solo file. EDITHA propone un nome libero da confermare. |
| Sposta in… | Scegli la cartella di destinazione da un elenco. Niente trascinamento, apposta: troppo facile sbagliare cartella. |
| Elimina | Chiede conferma. Il file eliminato resta nella cronologia di EDITHA e si può ripristinare. |
| Scarica / Scarica come zip | Un file, oppure un'intera cartella come archivio zip. |
| Copia percorso | Il percorso completo `/config/...`. |
| Cronologia… | Le versioni salvate del file (vedi [Cronologia](#cronologia-e-confronto)). |
| Seleziona per il confronto / Confronta con… | Confronta due file affiancati. |

- **Caricare file**: pulsante di caricamento, oppure trascina i file dal PC su una cartella.
- **Filtra per nome**: il campo sopra l'albero.
- **Immagini e PDF** si aprono in una tab di anteprima invece che nell'editor: PNG, JPEG, GIF,
  WebP, AVIF, BMP, ICO, SVG e PDF. La tab di anteprima è una sola e viene riusata dalla prossima
  immagine che apri. In alto compaiono le dimensioni in pixel e lo zoom attuale; un clic
  sull'immagine la mostra a grandezza reale (100%), un altro clic la riadatta. Le parti trasparenti
  mostrano una scacchiera. L'anteprima si chiude con la × della sua tab o con Esc.

  ![Anteprima di un'immagine](../docs/images/preview.png)
- **Cartelle di sistema** (`.storage`, `.cloud`, `deps`, `tts`, `.git`): sono nascoste. Il
  pulsante con l'occhio le mostra, **in sola lettura**: le gestisce Home Assistant e una modifica a
  mano può romperlo.

## Modificare i file

- **Salva** con Ctrl+S (Cmd+S su Mac), **salva tutto** con Ctrl+Alt+S.
- **Annulla e ripeti** annullano anche i rientri fatti con Tab.
- **Trova e sostituisci** nel file aperto: Ctrl+F.
- **A capo automatico** e **vista divisa** sono nella barra. La vista divisa mostra due file
  affiancati, oppure due punti dello stesso file: le modifiche fatte in una colonna compaiono
  nell'altra.

  ![Vista divisa](../docs/images/split-view.png)

- **Schema del file**: il pulsante con l'elenco puntato apre, a fianco dell'editor, lo schema del
  file YAML: in `automations.yaml` una voce per automazione, con il suo alias; in `scripts.yaml`
  una per script; in `configuration.yaml` e nei package le sezioni, con dentro automazioni, script
  e helper. Un clic porta alla voce; la voce in cui si trova il cursore resta evidenziata, e lo
  schema segue le modifiche mentre scrivi. Con molte voci compare in alto un filtro. Il pulsante
  accende e spegne lo schema, e EDITHA ricorda la scelta. Sul telefono non è disponibile.

  ![Schema del file](../docs/images/outline.png)

- **Linguaggi**: YAML, JSON, Python, JavaScript, CSS, Markdown e template Jinja sono colorati; gli
  altri file si aprono come testo semplice. Immagini e PDF si aprono in anteprima; gli altri file
  binari e quelli oltre 5 MB non si aprono nell'editor, ma si possono scaricare.

### Il lavoro non si perde

- Chiudere una tab o la pagina con modifiche non salvate chiede conferma.
- Se la pagina si chiude comunque (telefono bloccato, browser chiuso), EDITHA conserva le modifiche
  non salvate come **bozza** e la volta dopo propone di recuperarle.
- Se un file aperto cambia su disco (per esempio lo ha riscritto Home Assistant), EDITHA avvisa
  prima di salvare: scegli tu se ricaricarlo o sovrascriverlo.

## Aiuti per Home Assistant

### Controllo YAML spiegato

EDITHA controlla lo YAML mentre scrivi. Conosce i tag di Home Assistant (`!include`,
`!include_dir_*`, `!secret`, `!input`, `!env_var`) e, al posto del messaggio criptico della
libreria, dice cosa non va e in quale riga: due punti mancanti, una riga al livello di rientro
sbagliato, una tabulazione al posto degli spazi, una chiave ripetuta.

![Un errore YAML spiegato](../docs/images/problems.png)

Avvisa anche di errori tipici di Home Assistant che sono YAML valido, come `on`/`off`/`yes`/`no`
senza virgolette (lo YAML li trasforma in vero/falso).

Clic sul numero di errori nella barra di stato (oppure Ctrl+Maiusc+M) apre l'elenco dei problemi;
F8 passa al successivo.

### Suggerimenti mentre scrivi

Premi Ctrl+Spazio, oppure scrivi e basta:

- **entità** con nome e stato attuale, dopo `entity_id:` o appena scrivi un dominio come `light.`;
- **azioni** (`light.turn_on`, …) e i loro campi;
- **chiavi `!secret`** da `secrets.yaml` (solo i nomi: i valori non lasciano mai il server);
- **icone Material Design** dopo `mdi:`, con l'anteprima.

![Suggerimenti delle entità](../docs/images/autocomplete-entities.png)

![Suggerimenti delle icone](../docs/images/autocomplete-icons.png)

### Seguire include e secret

Ctrl+clic (Cmd+clic su Mac) su `!include file.yaml` apre il file, su `!include_dir_* cartella`
mostra la cartella nell'albero, su un nome `!secret` apre `secrets.yaml` a quella chiave.

### Pannello Inserisci

Il pulsante Inserisci apre un pannello laterale con due schede:

- **Entità**: cerca per nome o `entity_id` e inserisci nel punto del cursore. La lente accanto a
  un'entità mostra dove è usata nella configurazione.
- **Snippet**: blocchi pronti (automazione, script, sensore template, trigger, condizioni, azioni,
  helper). Tab passa da un campo da compilare al successivo. Seleziona del testo e salvalo come
  **snippet personale**; la matita lo modifica.

![Pannello Inserisci](../docs/images/insert-panel.png)

### Verifica, ricarica, riavvia

Il pulsante di Home Assistant nella barra:

- **Verifica configurazione**: chiede a Home Assistant di controllare tutta la configurazione e
  mostra l'esito.
- **Ricarica configurazione YAML**: prima verifica, poi ricarica automazioni, script, scene e tutto
  lo YAML che si può ricaricare senza riavviare.
- **Riavvia Home Assistant**: chiede conferma e **verifica sempre prima**: se la configurazione ha
  errori il riavvio viene annullato, così un errore di battitura non ti lascia senza Home
  Assistant.

![Menu di Home Assistant](../docs/images/ha-menu.png)

## Cerca e sostituisci in tutti i file

La lente sopra l'esplora file (Ctrl+Maiusc+F) cerca in tutti i file di `/config`, con
maiuscole/minuscole, parola intera ed espressioni regolari. Clic su un risultato apre il file a
quella riga. Cerca un `entity_id` con *parola intera* per trovare tutti i punti in cui è usato.

![Cerca in tutti i file](../docs/images/search.png)

Il pulsante con le frecce apre **Sostituisci**. *Sostituisci tutto* cambia tutte le occorrenze dopo
una conferma; il pulsante accanto a un file sostituisce solo lì. Ogni file modificato conserva la
versione precedente nella cronologia. I file con modifiche non salvate, `secrets.yaml` e le
cartelle di sistema non vengono mai toccati.

`secrets.yaml` è escluso dalla ricerca: password e chiavi non compaiono mai nei risultati.

## Cronologia e confronto

Prima di ogni salvataggio, eliminazione, rinomina, spostamento o sostituzione, EDITHA conserva la
versione precedente del file (le ultime **10 versioni** di ogni file). Il pulsante cronologia
nella barra le mostra accanto al contenuto attuale, con le differenze evidenziate; **Ripristina
questa versione** la riporta indietro (e si può annullare a sua volta, perché anche il contenuto
attuale viene conservato).

![Cronologia del file](../docs/images/history.png)

Per confrontare due file qualsiasi: tasto destro sul primo → **Seleziona per il confronto**, poi
tasto destro sul secondo → **Confronta con…**. Esc chiude il confronto.

La cronologia sta nello spazio dell'add-on, che viene incluso quando fai il backup dell'add-on.

## Telefono e tablet

EDITHA funziona nell'app di Home Assistant. Su uno schermo stretto l'esplora file diventa un
pannello che si apre dal pulsante nella barra, la barra mostra solo i pulsanti principali e su
iPhone un piccolo pulsante accanto al cursore chiude la tastiera.

| Editor | Esplora file |
| --- | --- |
| ![Editor sul telefono](../docs/images/phone-editor.png) | ![Esplora file sul telefono](../docs/images/phone-tree.png) |

## Scorciatoie da tastiera

Su Mac usa Cmd al posto di Ctrl.

| Tasti | Azione |
| --- | --- |
| Ctrl+S | Salva |
| Ctrl+Alt+S | Salva tutto |
| Alt+W | Chiudi la tab |
| Ctrl+Z / Ctrl+Y | Annulla / ripeti |
| Ctrl+F | Trova e sostituisci nel file |
| Ctrl+Maiusc+F | Cerca in tutti i file |
| Ctrl+Spazio | Suggerimenti |
| Tab / Maiusc+Tab | Aumenta / riduci il rientro |
| Ctrl+clic | Apri un `!include` o un `!secret` |
| Ctrl+Maiusc+M | Elenco dei problemi |
| F8 | Problema successivo |
| F2 | Rinomina (nell'esplora file) |
| Esc | Chiudi la cronologia, il confronto o l'anteprima |

## Sicurezza e privacy

- **Nessuna porta esposta**: EDITHA risponde solo al proxy Ingress di Home Assistant.
- **Solo `/config`**: nessun file fuori dalla cartella della configurazione può essere letto o
  scritto.
- **Salvataggi sicuri**: il file viene scritto in una copia temporanea e poi sostituito, così un
  disco pieno o un crash non lo lasciano mai scritto a metà.
- **Secret**: i valori di `secrets.yaml` si vedono solo aprendo quel file. Non arrivano mai al
  browser per i suggerimenti, non vengono cercati e non finiscono nei log.
- **Cartelle di sistema** in sola lettura.
- **Nessun bisogno di internet**: tutto quello che serve a EDITHA è dentro l'add-on.

## Problemi frequenti

**Dopo un aggiornamento l'icona o il titolo nella barra laterale non cambiano.** Home Assistant li
tiene in memoria: spegni e riaccendi *Mostra nella barra laterale* nella pagina dell'add-on,
oppure riavvia Home Assistant.

**Nessuna entità nei suggerimenti o nel pannello Inserisci.** EDITHA le legge da Home Assistant:
controlla che Home Assistant sia in funzione e premi il pulsante di aggiornamento nel pannello
Inserisci.

**Un file non si apre.** I file oltre 5 MB e i file binari (tranne immagini e PDF) non si possono
aprire: scaricali.

**Altro?** Apri una segnalazione su [GitHub](https://github.com/Trizompa/ha-addons/issues) con
cosa hai fatto, cosa ti aspettavi e, se puoi, il log dell'add-on (pagina dell'add-on → *Registro*).
