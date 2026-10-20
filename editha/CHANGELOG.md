# Changelog

## 0.35.0

- **Git, cartelle apribili**: la freccetta accanto a una cartella nuova mostra i suoi file, ognuno con la sua spunta e il suo occhio barrato. Così puoi mettere nel commit, o escludere per sempre, solo alcuni file di una cartella. La spunta della cartella diventa "in parte" e il conteggio dice quanti file entrano (per esempio `3 di 8 file`). Si vedono al massimo 200 file per cartella: gli altri entrano solo con la cartella intera.
- Barra dei pulsanti: senza un file aperto, i pulsanti **A capo automatico**, **Schema del file** e **Inserisci entità o snippet** sono spenti, come già ricerca e anteprima template.
- Documentazione in inglese: ora si vedono anche le immagini.

## 0.34.0

- **ZIP senza password**: scaricando una cartella come zip, `secrets.yaml` e le sue copie restano sempre fuori, ed EDITHA lo dice con un avviso. Il file da solo si scarica come prima.
- Git: dopo un commit, il primo file salvato compare già spuntato (prima arrivava senza spunta e il pulsante diceva «Commit (0 file)»).
- Documentazione: immagini rifatte con l'interfaccia di oggi, più le nuove per l'anteprima template e il pannello Git; requisiti riordinati.

## 0.33.0

- L'anteprima template non è più nel menu di Home Assistant (che ora ha solo verifica, ricarica e riavvio): resta il pulsante `{}` nella barra e Alt+T.
- Il pulsante **Cronologia del file** nella barra si comporta come gli altri: resta evidenziato mentre la cronologia è aperta e un secondo clic la chiude.
- Pannello Git: la legenda sta in un riquadro, una voce per riga (spunta, lettere N/M/E, occhio barrato, confronto); tolta la frase sul repository che resta in locale.
- Pagina iniziale: solo le scorciatoie, senza logo e nome ripetuti. Finestra Informazioni: tolta la riga Cronologia (lo spazio della cronologia si apre dal pannello Cronologia).
- Il motto è tra virgolette: “Every Day I Tweak HA”.

## 0.32.0

- **Git, Esclusi**: nel pannello Git una sezione elenca file e cartelle esclusi con l'occhio barrato; **Includi** li fa ricomparire, senza aprire il `.gitignore` a mano. Le righe aggiunte stanno sotto un titolo nel `.gitignore`.
- Sotto l'elenco delle modifiche una legenda spiega le lettere (N nuovo, M modificato, E eliminato), la spunta (cosa entra in questo commit) e l'occhio barrato (escludi per sempre).
- Il pulsante di confronto compare solo quando c'è un commit con cui confrontare (non prima del primo commit né per i file nuovi).
- Il `.gitignore` di base dei repository nuovi esclude anche i file temporanei lasciati da Home Assistant (`.nome.tmp.…`); in un repository già creato si escludono con l'occhio barrato.
- Se dopo «Includi» un'altra regola del `.gitignore` esclude ancora lo stesso file, EDITHA lo dice.

## 0.31.0

- **Git, primo commit più semplice**: una cartella che git non ha mai visto è ora una riga sola con il numero di file (per esempio `custom_components/ · 1450 file`), invece di migliaia di righe. Il commit di una cartella include i suoi file, tranne segreti e dati interni.
- **Escludi**: l'occhio barrato accanto a un file o una cartella nuovi li aggiunge al `.gitignore`, così spariscono dall'elenco e da tutti i commit.
- Al primo commit un avviso suggerisce di escludere prima le cartelle che non servono; con più di 2000 righe il commit è bloccato finché non si escludono cartelle.
- Sul telefono il pannello Git non è più trasparente.

## 0.30.0

- **Git locale completo.** Nel pannello Git:
  - il pulsante del confronto accanto a ogni file cambiato: le differenze rispetto all'ultimo commit, nella vista di confronto;
  - **Storia dei commit**: l'elenco dei commit, dal più recente; un clic mostra i file toccati;
  - per ogni file di un commit puoi **confrontare** quella versione con il file attuale o **ripristinarla** (con conferma). Il ripristino passa dal salvataggio di EDITHA, quindi il contenuto attuale resta nella cronologia; un file che ora non c'è viene ricreato.
- Segreti e dati interni di Home Assistant non si mostrano né si ripristinano dal repository.
- **Sicurezza** (riguarda anche la 0.28 e la 0.29): un `.git/config` scritto da un altro programma poteva far partire un comando chiedendo a git di scaricare oggetti mancanti. Ora git non usa mai la rete né scarica oggetti, in nessun caso.
- Il contenuto dei file dal repository si legge in modo rigoroso: un file non UTF-8 o un collegamento non vengono mostrati né ripristinati come testo rovinato.

## 0.29.0

- **Git locale: modifiche e commit.** Il pannello Git ora mostra i file cambiati dall'ultimo commit (**M** modificato, **N** nuovo, **E** eliminato), ognuno con una casella. Scrivi un messaggio e premi **Commit** per salvare una «fotografia» dei file spuntati. L'elenco si aggiorna da solo quando salvi un file con il pannello aperto; un clic sul nome apre il file.
- Non entrano mai in un commit, anche se il `.gitignore` è stato cambiato o manca: `secrets.yaml` e copie, dati interni e credenziali di Home Assistant (`.storage`, `.cloud`, token, database), file con un filtro di git e altri repository dentro `/config`. Compaiono con un lucchetto e il motivo.
- I file nuovi che compaiono mentre il pannello è aperto arrivano senza spunta. L'elenco si aggiorna anche dopo aver creato, eliminato, spostato o caricato file.
- Sicurezza: EDITHA lancia git con i programmi esterni spenti (filtri, hook, firme, pager…), anche se `.git/config` ne indica.

## 0.28.0

- **Git locale, primo passo**: nuovo pulsante **Git** in alto nell'esplora file. Apre un pannello che, se in `/config` non c'è ancora un repository, lo crea con **Inizializza repository Git** (ramo `main`) insieme a un `.gitignore` di base che tiene fuori `secrets.yaml` e copie, i dati interni di Home Assistant, database, registri e file temporanei. Un repository o un `.gitignore` esistenti si usano così come sono. Tutto resta sul tuo Home Assistant: niente push né pull. Stato, differenze, commit, storia e ripristino arrivano nei prossimi passi.
- Il programma git è ora incluso nell'add-on.

## 0.27.1

- **Anteprima template**: con il pannello aperto basta fare clic (o spostare il cursore) su un altro template, anche in un altro file, e l'anteprima si aggiorna da sola. Su una riga senza template resta il risultato di prima; muovendosi dentro lo stesso template Home Assistant non viene richiamato. Un testo selezionato si manda solo con Alt+T o il pulsante; nei file YAML molto grandi l'aggiornamento automatico è spento per non rallentare l'editor. Dopo un errore di connessione si riprova spostando il cursore.

## 0.27.0

- **Anteprima template**, secondo passo:
  - pulsante nella barra (le parentesi graffe), oltre ad Alt+T e al menu di Home Assistant;
  - l'anteprima si aggiorna da sola mentre modifichi il template;
  - pulsante **Copia** per il risultato;
  - avviso se il template cita entità che non esistono (Home Assistant in quel caso risponde `unknown` senza errore);
  - per gli errori di sintassi EDITHA cerca la riga (blocco non chiuso, `{{` aperto…) e offre **Vai alla riga N**.

## 0.26.0

- **Anteprima dei template Jinja**: con il cursore su un template (o selezionandolo) premi **Alt+T**, oppure scegli **Anteprima template** nel menu di Home Assistant. EDITHA manda a Home Assistant solo quel template, letto come lo legge HA (anche blocchi `|` e `>` e testo tra virgolette su più righe), e mostra il risultato in un pannello sotto l'editor: verde il risultato, rosso un errore di sintassi, arancione un errore di valutazione. Da `secrets.yaml` e dalle sue copie l'anteprima non parte mai.

## 0.25.0

- **Cancellare tutta la cronologia**: nel menu delle versioni da eliminare c'è la voce **tutte**. L'anteprima mostra quante versioni e quanto spazio, poi per confermare bisogna scrivere **CANCELLA** (il messaggio avvisa che è irreversibile). Vengono eliminati anche gli avanzi di salvataggi interrotti. Le versioni create dopo l'anteprima, i file in `/config` e le modifiche non salvate non vengono toccati; il registro dell'add-on annota la cancellazione.
- Il menu ora dice per intero cosa elimina («più vecchie di 30 giorni», …).

## 0.24.0

- **Pulizia della cronologia**: nella finestra *Cronologia: spazio e pulizia* puoi eliminare le versioni più vecchie di 7, 30, 90 giorni, un anno o una data a scelta. Prima **Anteprima** mostra quante versioni di quanti file se ne andrebbero e quanto spazio si libera, poi serve una conferma esplicita. Alla fine dice quanto spazio è stato liberato e il registro dell'add-on elenca cosa è stato eliminato. I file in `/config` non vengono mai toccati.

## 0.23.0

- **Spazio occupato dalla cronologia**: nuova finestra *Cronologia: spazio e pulizia*, da **Informazioni** (riga *Cronologia*) o dal pulsante a forma di disco nell'intestazione della cronologia. Mostra quanto spazio occupa davvero sul disco la cronologia, in tutto e file per file (dai più pesanti), con il numero di versioni, la data dell'ultima e i file che non esistono più. Per ora si guarda soltanto: la pulizia arriva nei prossimi passi.
- Dimensioni scritte con la virgola in italiano e fino ai GB.

## 0.22.4

- Se due finestre recuperano nello stesso momento le modifiche lasciate da una terza finestra chiusa, ora le ottiene una sola: l'altra non apre niente e avvisa che sono già state recuperate (o scartate) altrove. Prima finivano in entrambe.

## 0.22.3

- **Più finestre o dispositivi aperti insieme**: ognuno tiene le sue bozze delle modifiche non salvate. Una finestra non propone, non scarta e non sovrascrive più le bozze di un'altra ancora aperta (per esempio EDITHA sul PC e sul telefono). Ricaricando la pagina le proprie bozze vengono riconosciute e proposte come prima.
- Se una finestra si chiude senza salvare, o il telefono chiude l'app all'improvviso, un'altra finestra aperta propone le sue modifiche dopo circa un minuto e mezzo; la domanda non compare nelle schede nascoste e non interrompe un file su cui stai già lavorando.
- Dopo un riavvio dell'add-on le bozze delle finestre ancora aperte non vengono scambiate per abbandonate.
- Compilazione dell'interfaccia: niente più errore di esbuild nel registro quando l'output va su un file.

## 0.22.2

- Bozze: se all'apertura rispondi con Esc alla domanda sulle modifiche non salvate, le bozze restano davvero per dopo. Prima la prima modifica allo stesso file le sostituiva; ora, alla prima modifica di uno di quei file, EDITHA chiede se recuperarle o scartarle.
- La domanda che compare mentre scrivi ignora i tasti battuti per inerzia (Tab, spazio, Invio) finché non fai una pausa: non si può più scartare una bozza per sbaglio.
- Le bozze in sospeso seguono il file se lo rinomini o lo sposti, e vengono tolte se lo elimini.

## 0.22.1

- Un file con a capo misti (in parte Windows, in parte Linux) si vede di nuovo a righe normali: con la 0.22.0 alcune righe apparivano incollate. Questi file si salvano con gli a capo Linux; quelli tutti Windows restano Windows.
- Ricaricando un file dal disco (dopo una sostituzione, un ripristino o un conflitto) gli a capo non vengono più cambiati di nascosto.
- Esclusione dei segreti più precisa: `secret_sensori.yaml` o `secret-porta.yaml` tornano a essere file normali nella ricerca; restano esclusi `secrets*.yaml` e le copie di `secret.yaml`.

## 0.22.0

Secondo giro di revisione completa, più approfondito: soprattutto sicurezza dei dati.

**Nessuna modifica persa**
- Eliminare un file o una cartella oltre i 50 MB, o sostituirlo caricandone uno nuovo, non lascia copia di sicurezza: ora EDITHA lo dice **prima** e chiede una seconda conferma (prima la conferma prometteva una copia che non veniva fatta).
- Una copia conservata all'eliminazione si può ripristinare fino a 50 MB (prima solo fino a 5 MB).
- Se Home Assistant (o un altro programma) riscrive un file proprio mentre lo salvi, EDITHA non sovrascrive più la sua modifica: chiede cosa fare, come per ogni conflitto.
- Se EDITHA non risponde per un momento (aggiornamento, riavvio), le modifiche scritte nel frattempo vengono conservate appena torna; "Ricarica la pagina" scrive prima le bozze e avvisa se le modifiche andrebbero perse.
- Le bozze si salvano anche scrivendo di continuo, senza pause.
- Bozza di un file rinominato o eliminato da un'altra parte: EDITHA propone di **ricrearlo** con le modifiche invece di scartarle. Lo stesso al salvataggio di un file sparito nel frattempo.
- La domanda sulle bozze arriva prima di riaprire le tab, così non si sovrascrive una bozza scrivendo subito.
- I file con a capo di Windows (CRLF) restano così al salvataggio (prima diventavano a capo Linux).
- Ctrl+S su un file non modificato non propone più di sovrascrivere il file cambiato su disco; una ricarica automatica non cancella più il testo appena scritto, e mantiene cursore e posizione.
- Chiudendo una tab con "Salva", se nel frattempo hai scritto ancora, la tab resta aperta.

**Cronologia più robusta**
- Niente versioni doppie (salvataggi falliti e ripetuti, sostituzioni che non cambiano niente, ripristina e annulla): le versioni vere non vengono più spinte fuori dalle 10 conservate.
- Con l'orologio che torna indietro, o il disco pieno, non si perdono versioni e non restano copie troncate; le copie vengono scritte su disco prima di eliminare o sovrascrivere.

**Ricerca, segreti e download**
- Le copie di `secrets.yaml` sono escluse dalla ricerca in tutte le forme (anche `secrets.yaml_copia.bak` creato da "Duplica", `secrets.yaml.old`, `secret.yaml`…), e le cartelle `.storage`, `.cloud` e `.git` vengono saltate anche dentro altre cartelle.
- "Parola intera" funziona con le lettere accentate (cercando "caff" non trova più "Caffè"); le espressioni regolari non spezzano più le emoji.
- La conferma di "Sostituisci" indica il numero giusto di occorrenze anche oltre le 200 mostrate, con singolare e plurale corretti; un'espressione regolare sbagliata viene segnalata subito.
- Lo ZIP di una cartella non blocca più EDITHA per secondi, e i nomi strani vengono resi innocui.

**Controllo YAML ed editor**
- Nuovi errori spiegati: tab e spazi "invisibili" incollati da una pagina web, tag sconosciuti (`!secrets` → "forse intendevi !secret?"), apostrofo dentro `'…'`, due punti dentro un testo senza virgolette, `\d` tra virgolette doppie, `{% %}` all'inizio di un valore, spazio mancante dopo i due punti (`name:Casa`).
- Il JSON incollato con le tab non viene più segnalato come errore; nella cartella `esphome/` i tag di ESPHome (`!lambda`, `!extend`…) sono accettati.
- I file oltre 1 MB non vengono controllati né schematizzati (prima l'interfaccia si bloccava per secondi); la barra in basso lo indica.
- Le icone `mdi:` hanno tutte il nome giusto (37 erano sbagliate, es. `molecule-co2`).
- Uno snippet salvato da una selezione mantiene il rientro giusto.
- Cambiando lingua i messaggi del controllo YAML si aggiornano subito.

**Tastiera e interfaccia**
- Windows: AltGr+S (tastiere polacca, rumena, ungherese…) scrive di nuovo la lettera invece di salvare tutto. Le scorciatoie seguono la lettera della tastiera (AZERTY compresa).
- Alt+W chiude il file della colonna che stai usando; Esc su un menu chiude solo il menu; con una finestra aperta le scorciatoie non agiscono sui file sotto.
- Sul Mac i suggerimenti dei pulsanti mostrano ⌘, ⌥ e ⇧ (Ripeti è ⌘⇧Z).
- Cliccando due file di fila resta aperto l'ultimo cliccato.
- Messaggi di errore tradotti anche in inglese; anteprima con errori precisi (file sparito, troppo grande).

## 0.21.0

Revisione completa del codice: tante piccole correzioni, nessuna funzione nuova di rilievo.

**Ricerca e sostituzione**
- Sostituisci con espressioni regolari: `$1`, `$&`, `$<nome>` e le condizioni prima/dopo (lookaround) ora danno lo stesso risultato dell'anteprima.
- Anche le copie di `secrets.yaml` (es. `secrets.yaml.bak`, `secrets_old.yaml`) e i collegamenti a `secrets.yaml` sono esclusi da ricerca e sostituzione.
- Un file troppo grande viene saltato invece di bloccare tutto; un errore su un file non ferma gli altri; lo stesso file raggiunto da due percorsi viene modificato una volta sola.
- Una nuova ricerca ferma quella ancora in corso.

**File e cronologia**
- Un salvataggio dentro una cartella che si sta eliminando o spostando aspetta la fine dell'operazione, invece di incrociarsi con essa.
- Rinominare un file non fallisce più se non si riesce a spostare la sua cronologia.
- Con il disco pieno la creazione di un file non lascia un file vuoto a metà.
- Limiti di dimensione controllati anche alla creazione, alla sostituzione di un file caricato e al ripristino di una versione.
- Lo scaricamento di una cartella con troppi elementi per uno ZIP dà un errore chiaro.
- **Apri come testo** (menu del tasto destro) per i file SVG, che altrimenti si aprono in anteprima. "Apri a destra" non compare più per immagini e PDF.

**Editor e controllo YAML**
- Nuove spiegazioni: un modello `{{ … }}` usato senza virgolette all'inizio di un valore, una chiave che è una lista o un elenco, un alias `*nome` che non esiste.
- Due chiavi doppie in punti diversi del file sono segnalate entrambe; al massimo 200 problemi per file.
- Ctrl+clic: niente più collegamenti finti dentro le virgolette; `!include` in una lista `[a, b]` e percorsi che iniziano con `/config` funzionano.
- Scorciatoie (Ctrl+S, Ctrl+F, Alt+W…) indipendenti dalla tastiera e dal Mac; Esc chiude, in quest'ordine, cronologia, confronto e anteprima, ma non mentre si scrive in un campo.

**Bozze e interfaccia**
- Le modifiche non salvate vengono conservate in modo più affidabile chiudendo la pagina, anche nei file grandi.
- La bozza di un file che nel frattempo è stato cancellato o non si può più salvare viene scartata con un avviso, invece di essere riproposta a ogni apertura.
- Vista divisa: la barra in basso segue la colonna destra; aprendo un file a destra l'anteprima non la copre più.
- Lo schema del file azzera il filtro quando cambi file; la cronologia ignora le risposte arrivate dopo la chiusura; il confronto si aggiorna subito.
- Messaggi di errore più chiari ("non è un file", "anteprima non disponibile"…).

## 0.20.2

- Cronologia: se la finestra è già aperta e le si chiede un altro file, ora mostra le versioni di quel file (prima restavano quelle del file precedente). Una risposta lenta per il file di prima non può più sovrascrivere quella giusta.
- Documentazione: anteprima e schema del file anche nella presentazione dell'add-on e nel README; Esc chiude anche l'anteprima.

## 0.20.1

- Nell'albero le cartelle vuote non hanno più la freccia per espanderle: si vede subito che non contengono niente.

## 0.20.0

- **Schema del file**: nuovo pulsante nella barra (elenco puntato) che apre, a fianco dell'editor, lo schema del file YAML. In `automations.yaml` c'è una voce per ogni automazione, indicata con il suo alias; in `scripts.yaml` una per script; in `configuration.yaml` e nei package le sezioni, con dentro automazioni, script e helper. Un clic porta alla voce; quella in cui si trova il cursore resta evidenziata e lo schema si aggiorna mentre scrivi. Con molte voci compare un filtro. Il pulsante accende e spegne lo schema, ed EDITHA ricorda la scelta. Non disponibile sul telefono.

## 0.19.1

- L'anteprima di immagini e PDF ha la **sua tab** nella barra delle tab: si passa dall'anteprima ai file di testo e ritorno come tra tab normali, e la si chiude con la sua ×. La tab è una sola: la prossima immagine aperta la riusa. Chiudendo tutti i file di testo resta in primo piano l'anteprima.
- Accanto alle dimensioni compare lo **zoom** (es. "588 × 900 px · 82%"): si vede subito se l'immagine è adattata alla finestra o a grandezza reale.
- A grandezza reale l'immagine resta centrata invece di spostarsi a sinistra; se è più grande della finestra si scorre.
- Con l'anteprima in primo piano, salva, annulla e le altre azioni dell'editor non agiscono più sul file di testo nascosto sotto; albero e barra in basso indicano l'immagine.

## 0.19.0

- **Anteprima di immagini e PDF**: cliccando nell'albero un'immagine (PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, SVG) o un PDF, EDITHA la mostra al posto dell'editor invece di dire che il file non è testo. In alto nome, dimensioni in pixel e pulsante per scaricarla; un clic sull'immagine passa alla grandezza reale e ritorno; le parti trasparenti si vedono su una scacchiera. Esc, la X o un clic su una tab riportano all'editor.
- Nell'albero immagini e PDF hanno la loro icona.
- Sicurezza: un'immagine SVG non può eseguire codice nemmeno se aperta direttamente.

## 0.18.2

- Descrizione dell'add-on nel negozio: "Smart file editor for Home Assistant". Il motto "Every Day I Tweak HA" resta nell'interfaccia, nel logo e nella documentazione.

## 0.18.1

- Nuovo file e nuova cartella restano solo nei pulsanti sopra l'albero dei file (e nel menu del tasto destro): tolto il doppione dalla barra in alto.

## 0.18.0

- **Documentazione completa**, in inglese (scheda *Documentazione* dell'add-on) e in italiano (`DOCS.it.md` su GitHub), con le immagini di tutte le funzioni.
- Errore YAML spiegato anche quando mancano i due punti tra chiave e valore sulla stessa riga: `below 30` → «Alla riga 10 mancano i due punti dopo "below": probabilmente deve essere "below: 30"».
- Informazioni: lo sviluppatore compare con l'alias GitHub (Trizompa), con il link al profilo.
- Descrizione dell'add-on nel negozio: "Every Day I Tweak HA – the Home Assistant configuration editor".

## 0.17.2

- Su telefono la barra in alto mostra solo il nome EDITHA, senza il logo: più spazio per i pulsanti.

## 0.17.1

- Nuovo motto: **Every Day I Tweak HA** (le iniziali formano il nome). Nell'interfaccia il nome si scrive in maiuscolo: EDITHA.
- Sopra l'albero dei file non c'è più la scritta "Esplora file", che su schermi stretti andava su due righe: restano solo i pulsanti.

## 0.17.0

- **Modifica degli snippet personali**: nel pannello Inserisci → Snippet, la matita accanto a ogni snippet personale apre una finestra per cambiarne nome e testo (Tab inserisce due spazi, come nell'editor).

## 0.16.1

- Icona di Editha nella barra laterale: `mdi:pencil`. Per vederla, dopo l'aggiornamento spegnere e riaccendere "Mostra nella barra laterale" nella pagina dell'add-on (oppure riavviare Home Assistant).

## 0.16.0

- **Confronta due file**: tasto destro su un file → "Seleziona per il confronto", poi tasto destro su un altro file → "Confronta con …". I due file si vedono affiancati con le differenze evidenziate (in un'unica colonna su telefono). Se un file è aperto con modifiche non salvate, si confronta il testo dell'editor. Esc chiude il confronto.
- Nuova icona di Editha nella barra laterale di Home Assistant: `mdi:pencil-circle-outline`.

## 0.15.0

- **Sostituisci in più file**: nel pannello "Cerca nei file", il pulsante con le frecce apre il campo "Sostituisci con". "Sostituisci tutto" cambia tutte le occorrenze trovate; il pulsante accanto a ogni file sostituisce solo in quel file. Prima di modificare Editha chiede conferma e conserva la versione precedente di ogni file nella sua cronologia, da cui si può ripristinare. Con le espressioni regolari si possono usare i gruppi (`$1`).
- Protezioni: i file aperti con modifiche non salvate vengono saltati (Editha lo dice), così come `secrets.yaml`, le cartelle di sistema e i file cambiati nel frattempo. Le tab aperte si aggiornano subito con il testo nuovo. Un'espressione regolare troppo lenta non modifica nessun file.

## 0.14.0

- **Icone MDI**: scrivendo `mdi:` l'editor propone le icone Material Design per nome, ognuna con la sua anteprima (es. `mdi:lightb` → lightbulb, lightbulb-outline, …). L'elenco delle icone (~7400) si scarica solo la prima volta che serve.
- "Cerca in tutti i file" resta solo come lente sopra l'albero dei file (e con Ctrl+Maiusc+F): tolto il doppione dalla barra in alto.

## 0.13.2

- **Chiudi la tastiera su iPhone**: il pulsante ora compare accanto al cursore, sul lato destro dell'editor, mentre scrivi. Prima stava nella barra in alto, che iOS fa scorrere fuori dallo schermo quando apre la tastiera, quindi non si vedeva. Lingua e tema restano sempre al loro posto.
- La ricerca in tutti i file non guarda più dentro `secrets.yaml`: password e chiavi non compaiono nei risultati.

## 0.13.1

Revisione generale del codice, con queste correzioni:

**Salvataggi e bozze**
- Due Ctrl+S ravvicinati (con la rete o HA lenti) davano un falso "file modificato fuori da Editha" e, scegliendo "Ricarica", si perdevano le ultime modifiche. Ora i salvataggi della stessa tab vanno in coda.
- Una bozza scritta mentre si salvava restava sul server e veniva riproposta all'apertura successiva. Ora le bozze vecchie vengono eliminate; una bozza uguale al file su disco non viene più proposta.
- Le bozze e la sessione inviate alla chiusura della pagina arrivano a destinazione anche se la pagina si chiude subito.

**Ricerca**
- Un'espressione regolare "patologica" (es. `(a+)+$`) poteva bloccare Editha per minuti. Ora la ricerca gira separata dal resto e si ferma dopo 8 secondi, mostrando i risultati trovati fino a lì.
- Nelle righe molto lunghe il testo trovato oltre il 400° carattere ora è visibile ed evidenziato.
- Svuotando il campo di ricerca non ricompaiono più i risultati di una ricerca precedente.

**File**
- Due spostamenti verso lo stesso nome nello stesso istante potevano far sparire un file. Ora uno dei due si ferma con "esiste già".
- Spostando o rinominando una cartella, la cronologia dei file al suo interno la segue.
- La cronologia di un file aperto attraverso un collegamento ora è quella del file reale.
- I file e le cartelle molto grandi (oltre 50 MB) si eliminano senza copia di sicurezza, invece di riempire lo spazio dell'add-on o fallire; Editha lo segnala. Duplicare una cartella oltre 50 MB non è consentito.
- Scaricare una cartella con un file enorme non esaurisce più la memoria.
- Errori come "disco pieno" o "permesso negato" ora vengono spiegati invece di un generico "errore interno".
- `secrets.yaml` viene letto con un vero lettore YAML: un valore su più righe non può più comparire tra i suggerimenti come se fosse una chiave.

**Controllo YAML**
- `chiave: &ancora` e `chiave: !!map` seguite da un blocco non vengono più indicate come errore, e non nascondono più gli errori successivi.
- Niente avvisi su più `<<: *ancora` nello stesso blocco, che HA unisce.
- Niente avvisi su `!secret on` o `!input yes`, che sono nomi, e su elenchi di icone come `- mdi:home`.
- Niente avvisi sul rientro delle righe interne di `[ ]` e `{ }` su più righe.
- Il nome della chiave ripetuta ora è quello giusto anche con virgolette o dentro `{ }`.
- Cambiando lingua, anche i messaggi del controllo cambiano subito lingua.

**Altro**
- Ctrl+clic su `!include /config/…` (percorso assoluto) apre il file giusto; i collegamenti dentro i commenti vengono ignorati.
- Esc su un menu non chiude più anche la cronologia aperta. La cronologia si chiude se il file viene spostato o eliminato.
- Chiudendo una tab non attiva con modifiche, resta attiva la tab di prima.
- I suggerimenti "Piega"/"Espandi" ora sono tradotti; i nomi di file con lettere accentate rispettano il limite di lunghezza del disco.

## 0.13.0

- **Cerca in tutti i file** (Ctrl+Maiusc+F, pulsante nella barra o lente nell'albero): la ricerca prende il posto dell'albero nella barra laterale. Opzioni maiuscole/minuscole, parola intera ed espressione regolare. I risultati sono raggruppati per file, con la riga e il testo trovato evidenziato; un clic apre il file con il testo selezionato. Escluse le cartelle di sistema, i database e i file binari.
- **Dove è usata un'entità**: dal pannello Inserisci, pulsante accanto a ogni entità; oppure con il cursore su un `entity_id` e Ctrl+Maiusc+F. Cerca la parola intera, quindi trova `light.cucina` anche dentro i template (`states.light.cucina.state`) ma non `light.cucina_2`, e mostra nome e stato dell'entità.

## 0.12.0

- **Sposta in…** nel menu contestuale di file e cartelle (anche su telefono, tenendo premuto). Si sceglie la cartella di destinazione da un elenco filtrabile; non si può spostare nella cartella dove il file sta già, né una cartella dentro sé stessa, né nelle cartelle di sistema. Le tab aperte, le bozze e la cronologia delle versioni seguono il file. Niente trascinamento, per evitare spostamenti per sbaglio.

## 0.11.0

- **`!secret`**: scrivendo `!secret ` l'editor propone le chiavi di `secrets.yaml` (solo i nomi: i valori non escono mai dal server). Come HA, cerca `secrets.yaml` nella cartella del file e poi in quelle sopra fino a `/config`.
- **Ctrl+clic** (Cmd+clic su Mac) sui collegamenti, che sono sottolineati a puntini:
  - su `!include file.yaml` apre il file (percorso relativo alla cartella del file, come in HA);
  - su `!include_dir_named`, `!include_dir_list`, `!include_dir_merge_…` apre la cartella nell'albero;
  - su `!secret chiave` apre `secrets.yaml` sulla riga di quella chiave.

## 0.10.4

- Schermi molto stretti (sotto i 370 px): nella barra resta solo il logo, così tutti i pulsanti ci stanno e la pagina non si sposta più di lato tagliando il nome e la barra di stato.

## 0.10.3

- Corretto: dopo una chiave senza «:» venivano segnalate come sbagliate anche le righe giuste sotto (per esempio "All mapping items must start at the same column" su `max:`). Ora per quel blocco resta solo la spiegazione della riga da correggere.

## 0.10.2

- Spiegazioni più chiare quando una riga è più rientrata di quella sopra:
  - se alla riga sopra mancano i due punti: "Alla riga 28 mancano i due punti dopo «car_wican»: per contenere le righe sotto deve essere «car_wican:»";
  - se la riga sopra ha già un valore: "La riga 12 ha già un valore («name: Casa»), quindi non può contenere la riga 13";
  - negli altri casi il messaggio dice quale riga correggere e come.

## 0.10.1

- Corretto: nel tema scuro, l'elenco per scegliere il file della colonna destra (vista divisa) mostrava testo chiaro su sfondo bianco, illeggibile su Windows.

## 0.10.0

- **Controllo YAML più chiaro**: per gli errori di indentazione Editha spiega cosa non va e dove, con i numeri di riga. Per esempio "la riga 9 rientra di 5 spazi: nessun blocco sopra parte da lì (livelli possibili: 0, 2, 4, 6, 8)", oppure "per far parte dell'elemento di lista della riga 2 deve rientrare di 4 spazi, allineata a «platform»". Anche le chiavi ripetute dicono quale chiave è.
- **Nuovi avvisi** per errori tipici di Home Assistant che restano YAML valido:
  - `on`/`off`/`yes`/`no` senza virgolette, che HA legge come vero/falso (`to: on` in un trigger);
  - `chiave:valore` senza spazio dopo i due punti, letto come testo;
  - rientri dispari in un file che va di 2 in 2.
- **Elenco dei problemi**: un clic sul conteggio "N errori · N avvisi" nella barra in basso (o Ctrl+Maiusc+M) apre l'elenco completo, con il numero di riga di ciascuno; un clic porta alla riga.

## 0.9.1

- Informazioni: sviluppatore Trizompa; tolto il riferimento a File Editor Plus.
- Documentazione e licenza aggiornate con il nome dell'autore.

## 0.9.0

- **Vista divisa in due colonne** (solo su PC e tablet): pulsante nella barra, oppure "Apri a destra" nel menu di un file. Nella colonna destra si sceglie quale file mostrare tra quelli aperti; può essere anche lo stesso file della colonna sinistra, per vedere due punti diversi: le modifiche fatte in una colonna compaiono subito nell'altra. Salva, Annulla, Cerca e Inserisci agiscono sulla colonna usata per ultima (segnata da una linea blu). La vista divisa resta uscendo e rientrando.
- **Informazioni**: pulsante accanto a lingua e tema con sviluppatore (Trizompa), GitHub, repository, versione, licenza e le librerie usate. Su telefono si trova nel menu della lingua.

## 0.8.1

- Corretto su iPhone: trascinando l'editor verso destra oltre il bordo, l'effetto elastico di iOS spostava anche la colonna dei numeri di riga. Ora lo scorrimento si ferma ai bordi, anche per la pagina e per il confronto della cronologia.

## 0.8.0

- **Bozze delle modifiche non salvate**: mentre scrivi Editha conserva le modifiche non ancora salvate (dopo un secondo di pausa, e subito quando la pagina viene chiusa o passi a un'altra app). Se chiudi la pagina, HA si riavvia o il telefono chiude l'app, alla riapertura Editha chiede se recuperarle o scartarle. Le modifiche recuperate tornano nella loro tab, da salvare; se nel frattempo il file è cambiato su disco, al salvataggio Editha chiede cosa fare.

## 0.7.1

- **Telefono: pulsante "Chiudi la tastiera"**. Su iPhone la tastiera si chiude solo togliendo il focus all'editor, e nella pagina non c'era un modo per farlo: ora, mentre scrivi, al posto di lingua e tema compare il pulsante con la tastiera. Aprendo un file su telefono la tastiera non si apre più da sola.
- **Duplica più sicuro**: solo per i file. La copia di un file YAML viene proposta come `nome_copia.yaml.bak`, che Home Assistant non carica (niente automazioni o sensori doppi in `packages` o nelle cartelle `!include_dir_…`); Editha la mostra comunque come YAML. Un nome che finisce in `.yaml` va confermato.
- Tra il testo "Easy Developer IDE for The HA" e il primo pulsante la stessa distanza che c'è tra logo e "Editha".

## 0.7.0

- **Cronologia dei file**: pulsante "Cronologia del file" nella barra, o voce "Cronologia…" nel menu di un file. Elenca le versioni conservate da Editha (prima di ogni salvataggio, ripristino o eliminazione), le confronta con il contenuto attuale (affiancate su PC, in un'unica colonna su telefono) e ripristina quella scelta. Il contenuto sostituito diventa a sua volta una versione, quindi il ripristino si annulla.
- Conservate **10 versioni per file** invece di 50 (configurabile con `EDITHA_BACKUP_KEEP`); le versioni in più spariscono al salvataggio successivo.
- **Duplica** file e cartelle dal menu contestuale, con il nome della copia proposto (`nome_copia.yaml`).
- Su telefono il menu contestuale dell'albero si apre con una pressione prolungata.
- Barra in alto su telefono: tutti i pulsanti stanno nella riga anche su iPhone (prima il tema era tagliato).

## 0.6.1

- Logo e nome di Editha nell'angolo in alto a sinistra; il pulsante che mostra/nasconde l'albero passa insieme agli altri comandi.
- Corretto: su finestre molto basse la schermata iniziale copriva i pulsanti della barra.

## 0.6.0

- **Upload dal PC**: pulsante nell'albero, voce "Carica file qui…" nel menu di una cartella, oppure trascinando i file dal PC sopra una cartella. Se un file esiste già Editha chiede se sostituirlo; la versione precedente resta nei backup. Le cartelle di sistema restano protette.
- **Download sul PC**: "Scarica sul PC" per un file (anche immagini e file binari), "Scarica come zip" per una cartella.
- Limite di 50 MB per singolo trasferimento (configurabile con `EDITHA_MAX_TRANSFER`).

## 0.5.0

- Interfaccia in italiano e inglese: selettore della lingua nella barra in alto (Automatica, Italiano, English). La scelta resta memorizzata e si applica subito, senza ricaricare la pagina; "Automatica" segue la lingua del browser.
- Tradotti anche il pannello di ricerca dell'editor, i messaggi del validatore YAML e gli snippet predefiniti (nomi e testi di esempio).

## 0.4.2

- Corretto: entità, autocompletamento e menu Home Assistant non funzionavano nell'add-on ("Home Assistant non è raggiungibile da qui"). Il token del Supervisor ora viene letto anche quando l'avvio passa da s6-overlay; il log indica all'avvio se le API di HA sono disponibili.
- Carattere dell'editor a 13 px su PC (14 px su telefono).
- Dopo un aggiornamento la nuova interfaccia viene caricata senza refresh forzato del browser.

## 0.4.1

- Se Editha non risponde (add-on in aggiornamento o riavvio con la pagina aperta) compare un avviso con "Ricarica la pagina", che sparisce da solo quando il server torna; dopo un aggiornamento dell'add-on l'avviso invita a ricaricare per usare la nuova versione.
- Le letture si ritentano una volta prima di segnalare un errore.
- Spazio tra "Editha" e "Easy Developer IDE for The HA" uguale a quello tra logo e nome.

## 0.4.0

- Menu **Home Assistant** nella barra: verifica della configurazione, ricarica della configurazione YAML e riavvio. Ricarica e riavvio partono solo se la verifica passa; gli errori di HA vengono mostrati per intero e l'esito è quello reale.
- Pannello **Inserisci**: entità del proprio HA (nome, `entity_id`, stato) e snippet, predefiniti e personali ("Salva la selezione come snippet").
- Autocompletamento di entità e azioni mentre si scrive (`light.`, `entity_id:`, `action:`), con stato attuale.
- Colonna dei numeri di riga più stretta e vicina al codice anche su desktop.
- Più spazio tra "Editha" e "Easy Developer IDE for The HA".
- Le impostazioni si salvano con POST invece di PATCH (più compatibile con i proxy).

## 0.3.1

- Descrizione semplificata: "Easy Developer IDE for The HA".

## 0.3.0

- Nuovo nome: **Editha** – Easy Developer IDE for The HA. Lo slug passa da `edith` a `editha`: per Home Assistant è un add-on nuovo, quindi va installato Editha e disinstallato Edith (impostazioni e backup di Edith non vengono trasferiti).

## 0.2.2

- Telefono: colonna dei numeri di riga più stretta (da 82 a 51 px su un iPhone).
- Con l'a capo automatico il seguito di una riga lunga resta allineato alla sua indentazione.

## 0.2.1

- Le cartelle di sistema in sola lettura (`.storage`, `.cloud`, `deps`, `tts`, `.git`) sono nascoste nell'albero; il pulsante a forma di occhio le mostra. La scelta resta memorizzata.

## 0.2.0

- Interfaccia grafica: albero dei file, tab, editor CodeMirror 6, barra degli strumenti e barra di stato.
- Validazione YAML in tempo reale che riconosce `!include`, `!secret` e gli altri tag di Home Assistant.
- Menu contestuale con nuovo file, nuova cartella, rinomina, elimina e copia percorso.
- Avviso per le modifiche non salvate e gestione dei file modificati fuori da Editha.
- Tema automatico, chiaro o scuro; tab aperte e tema ritrovati al rientro.
- Utilizzabile anche da telefono: l'albero diventa un pannello laterale.
- Test nel browser per ciascun problema segnalato su File Editor Plus (#4–#19).

## 0.1.0

- Server (TypeScript, Fastify) raggiungibile solo dal proxy Ingress.
- API dei file di `/config`: elenco, lettura, salvataggio, creazione, rinomina, eliminazione.
- Salvataggio atomico con rilevamento dei conflitti; copia della versione precedente in `/data/backups`.
- Cartelle `.storage`, `.cloud`, `deps`, `tts`, `.git` in sola lettura.
- Pagina provvisoria nel pannello: l'editor arriva nella prossima versione.

## 0.0.1

- Struttura iniziale dell'add-on (non installabile).
