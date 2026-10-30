import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const configDir = path.join(process.env.EDITHA_E2E_ROOT!, 'config');
const disk = (rel: string) => readFile(path.join(configDir, rel), 'utf8');

const row = (page: Page, p: string) => page.locator(`editha-file-tree .row[data-path="${p}"]`);
const tab = (page: Page, p: string) => page.locator(`editha-tab-bar .tab[data-path="${p}"]`);
const activeTab = (page: Page) => page.locator('editha-tab-bar .tab.active');
const editor = (page: Page) => page.locator('editha-editor-pane .cm-content');
const dialogButton = (page: Page, label: string) =>
  page.locator('editha-dialog dialog[open] button', { hasText: new RegExp(`^\\s*${label}\\s*$`) });
const menuItem = (page: Page, label: string) =>
  page.locator('editha-context-menu button', { hasText: label });

async function openFile(page: Page, p: string) {
  const parts = p.split('/');
  for (let i = 1; i < parts.length; i++) {
    const dir = parts.slice(0, i).join('/');
    const r = row(page, dir);
    if ((await r.getAttribute('aria-expanded')) !== 'true') await r.click();
  }
  await row(page, p).click();
  await expect(activeTab(page)).toHaveAttribute('data-path', p);
}

/** BK-7: la finestra dello spazio si apre dal pannello Cronologia (con un file aperto). */
async function openSpaceDialog(page: Page) {
  if (!(await activeTab(page).count())) await openFile(page, 'spazio/pulisci.yaml');
  await page.locator('editha-toolbar button[aria-label="Cronologia del file"]').click();
  await page.locator('editha-history-panel button[title="Spazio occupato dalla cronologia"]').click();
}

test.beforeEach(async ({ page, request }) => {
  // Ogni test parte da sessione e impostazioni pulite.
  await request.put('api/session', { data: { tabs: [], active: null } });
  for (const d of (await (await request.get('api/drafts')).json()).drafts) {
    await request.delete(`api/draft?path=${encodeURIComponent(d.path)}`);
  }
  await request.post('api/settings', { data: { theme: 'auto', sidebarVisible: true, wordWrap: false, showSystem: false, language: 'it', outlineVisible: false } });
  await page.goto('./');
  // Su telefono l'albero parte chiuso: basta che sia caricato.
  await expect(row(page, 'configuration.yaml')).toBeAttached();
});

test('FEP #19 – chiudendo la tab attiva l\'editor mostra la nuova tab attiva e salva il file giusto', async ({ page }) => {
  await openFile(page, 'tabs/a.yaml');
  await openFile(page, 'tabs/b.yaml');
  await openFile(page, 'tabs/c.yaml');
  await tab(page, 'tabs/b.yaml').click();
  await expect(editor(page)).toContainText('contenuto: B');

  await tab(page, 'tabs/b.yaml').locator('button.close').click();
  await expect(tab(page, 'tabs/b.yaml')).toHaveCount(0);
  await expect(activeTab(page)).toHaveAttribute('data-path', 'tabs/c.yaml');
  await expect(editor(page)).toContainText('contenuto: C');

  await editor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('modificato: si\n');
  await page.keyboard.press('Control+s');
  await expect(activeTab(page)).not.toHaveClass(/dirty/);
  expect(await disk('tabs/c.yaml')).toBe('contenuto: C\nmodificato: si\n');
  expect(await disk('tabs/b.yaml')).toBe('contenuto: B\n');
  expect(await disk('tabs/a.yaml')).toBe('contenuto: A\n');

  // Chiudendo tutte le tab si torna alla schermata iniziale.
  await page.keyboard.press('Alt+w');
  await page.keyboard.press('Alt+w');
  await expect(page.locator('editha-app .welcome')).toBeVisible();
});

test('FEP #18 – rinomina dal menu contestuale, anche con il file aperto', async ({ page }) => {
  await openFile(page, 'rename/vecchio.yaml');
  await row(page, 'rename/vecchio.yaml').click({ button: 'right' });
  await menuItem(page, 'Rinomina').click();
  const input = page.locator('editha-dialog input');
  await input.fill('nuovo.yaml');
  await dialogButton(page, 'Rinomina').click();
  await expect(row(page, 'rename/nuovo.yaml')).toBeVisible();
  await expect(activeTab(page)).toHaveAttribute('data-path', 'rename/nuovo.yaml');
  expect(await disk('rename/nuovo.yaml')).toBe('x: 1\n');
});

test('FEP #11 e #12 – nuovo file nella cartella vuota selezionata, dal menu contestuale', async ({ page }) => {
  await row(page, 'vuota').click({ button: 'right' });
  await menuItem(page, 'Nuovo file').click();
  await page.locator('editha-dialog input').fill('scene.yaml');
  await dialogButton(page, 'Crea').click();
  await expect(row(page, 'vuota/scene.yaml')).toBeVisible();
  await expect(activeTab(page)).toHaveAttribute('data-path', 'vuota/scene.yaml');
  expect(await disk('vuota/scene.yaml')).toBe('');

  // Dai pulsanti sopra l'albero: destinazione = cartella selezionata.
  await row(page, 'vuota').click();
  await row(page, 'vuota').click();
  await page.locator('editha-file-tree header button[title="Nuova cartella"]').click();
  await page.locator('editha-dialog input').fill('sotto');
  await dialogButton(page, 'Crea').click();
  await expect(row(page, 'vuota/sotto')).toBeVisible();
});

test('FEP #10 – chiudere un file modificato chiede cosa fare', async ({ page }) => {
  await openFile(page, 'unsaved/file.yaml');
  await editor(page).click();
  await page.keyboard.type('# modifica ');
  await expect(activeTab(page)).toHaveClass(/dirty/);

  await page.keyboard.press('Alt+w');
  await expect(page.locator('editha-dialog h2')).toHaveText('Modifiche non salvate');
  await dialogButton(page, 'Annulla').click();
  await expect(tab(page, 'unsaved/file.yaml')).toBeVisible();

  await page.keyboard.press('Alt+w');
  await dialogButton(page, 'Non salvare').click();
  await expect(tab(page, 'unsaved/file.yaml')).toHaveCount(0);
  expect(await disk('unsaved/file.yaml')).toBe('originale: true\n');
});

test('FEP #6 – il tema scelto resta dopo essere usciti e rientrati', async ({ page }) => {
  const themeButton = page.locator('editha-toolbar button[title^="Tema"]');
  await themeButton.click(); // chiaro
  await themeButton.click(); // scuro
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('editha-toolbar button[title="Tema: Scuro"]')).toBeVisible();
});

test('FEP #13 – rientrando si ritrovano le tab e la tab attiva', async ({ page }) => {
  await openFile(page, 'session/uno.yaml');
  await openFile(page, 'session/due.yaml');
  await tab(page, 'session/uno.yaml').click();
  await page.waitForTimeout(900); // salvataggio della sessione
  await page.reload();
  await expect(tab(page, 'session/uno.yaml')).toBeVisible();
  await expect(tab(page, 'session/due.yaml')).toBeVisible();
  await expect(activeTab(page)).toHaveAttribute('data-path', 'session/uno.yaml');
  await expect(editor(page)).toContainText('uno: 1');
  const order = await page.locator('editha-tab-bar .tab').evaluateAll((els) => els.map((e) => e.getAttribute('data-path')));
  expect(order).toEqual(['session/uno.yaml', 'session/due.yaml']);
});

test('FEP #5 – niente controllo ortografico o traduzione nell\'editor', async ({ page }) => {
  await openFile(page, 'configuration.yaml');
  await expect(editor(page)).toHaveAttribute('spellcheck', 'false');
  await expect(editor(page)).toHaveAttribute('translate', 'no');
  await expect(page.locator('editha-editor-pane .cm-lintRange')).toHaveCount(0);
});

test('FEP #4 – l\'albero scorre fino all\'ultimo file', async ({ page }) => {
  await row(page, 'many').click();
  const last = row(page, 'many/file_60.yaml');
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(activeTab(page)).toHaveAttribute('data-path', 'many/file_60.yaml');
});

test('FEP #15 – l\'editor scorre fino all\'ultima riga di un file lungo', async ({ page }) => {
  await openFile(page, 'long/lungo.yaml');
  await editor(page).click();
  await page.keyboard.press('Control+End');
  await expect(page.locator('editha-editor-pane .cm-line', { hasText: 'riga_300: 300' })).toBeInViewport();
  await expect(page.locator('editha-status-bar')).toContainText('Riga 301');
});

test('FEP #8 e #14 – Tab indenta la selezione e Annulla la riporta com\'era', async ({ page }) => {
  await openFile(page, 'indent/file.yaml');
  await editor(page).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Tab');
  await expect(editor(page)).toContainText('  uno: 1');
  expect(await page.locator('editha-editor-pane .cm-line').allTextContents()).toEqual(['  uno: 1', '  due: 2', '  tre: 3', '']);
  await page.keyboard.press('Control+z');
  expect(await page.locator('editha-editor-pane .cm-line').allTextContents()).toEqual(['uno: 1', 'due: 2', 'tre: 3', '']);
  await expect(activeTab(page)).not.toHaveClass(/dirty/);
});

test('SEC-4 – file modificato fuori da Editha: ricarica dal disco', async ({ page }) => {
  await openFile(page, 'conflict/file.yaml');
  await writeFile(path.join(configDir, 'conflict/file.yaml'), 'versione: esterna\n');
  await editor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('mia: modifica\n');
  await page.keyboard.press('Control+s');
  await expect(page.locator('editha-dialog h2')).toHaveText('File modificato fuori da EDITHA');
  await dialogButton(page, 'Ricarica dal disco').click();
  await expect(editor(page)).toContainText('versione: esterna');
  await expect(activeTab(page)).not.toHaveClass(/dirty/);
  expect(await disk('conflict/file.yaml')).toBe('versione: esterna\n');
});

test('FS-4 – eliminare un file chiede conferma e chiude la sua tab', async ({ page }) => {
  await openFile(page, 'delete/via.yaml');
  await row(page, 'delete/via.yaml').click({ button: 'right' });
  await menuItem(page, 'Elimina').click();
  await dialogButton(page, 'Elimina').click();
  await expect(row(page, 'delete/via.yaml')).toHaveCount(0);
  await expect(tab(page, 'delete/via.yaml')).toHaveCount(0);
  await expect(disk('delete/via.yaml')).rejects.toThrow();
});

test('SEC-8 – le cartelle di sistema sono nascoste, si mostrano a richiesta e la scelta resta', async ({ page }) => {
  await expect(row(page, '.storage')).toHaveCount(0);
  await expect(row(page, 'configuration.yaml')).toBeVisible();
  await page.locator('editha-file-tree button[data-action="toggle-system"]').click();
  await expect(row(page, '.storage')).toBeVisible();
  await page.waitForTimeout(300);
  await page.reload();
  await expect(row(page, '.storage')).toBeVisible();
  await page.locator('editha-file-tree button[data-action="toggle-system"]').click();
  await expect(row(page, '.storage')).toHaveCount(0);
});

test('FS-11 – galleria delle immagini di una cartella: filtro, immagine in grande, rinomina', async ({ page }) => {
  await row(page, 'galleria').click({ button: 'right' });
  await menuItem(page, 'Mostra come galleria').click();
  const gallery = page.locator('editha-gallery-panel');
  await expect(gallery.locator('header h2')).toContainText('3 immagini');
  // Solo le immagini della cartella: niente testo, niente sottocartelle.
  await expect(gallery.locator('.card')).toHaveCount(3);
  await expect(gallery.locator('.card .name')).toHaveText(['luce_on_v2.svg', 'luce_on.svg', 'porta.svg']);
  await expect(page.locator('editha-tab-bar .tab.preview.active')).toContainText('galleria');
  // Le miniature si caricano davvero (l'indirizzo con la data di modifica è accettato dal server).
  await expect.poll(() => gallery.locator('.card img').first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  await gallery.locator('.search input').fill('luce');
  await expect(gallery.locator('.card')).toHaveCount(2);
  await expect(gallery.locator('.note')).toContainText('Filtro: 2 di 3');

  // In grande, con le frecce; Esc torna alla griglia, un altro Esc chiude la galleria.
  await gallery.locator('.card', { hasText: 'luce_on.svg' }).click();
  const viewer = gallery.locator('.viewer');
  await expect(viewer.locator('h2')).toContainText('luce_on.svg');
  await expect(viewer.locator('h2')).toContainText('2 di 2');
  // Dopo l'ultima si ricomincia dalla prima.
  await page.keyboard.press('ArrowRight');
  await expect(viewer.locator('h2')).toContainText('luce_on_v2.svg');
  await expect(viewer.locator('h2')).toContainText('1 di 2');
  // Con il visore aperto, le frecce in un campo di testo restano al campo.
  const treeFilter = page.locator('editha-file-tree input').first();
  await treeFilter.fill('ab');
  await treeFilter.press('ArrowLeft');
  await expect(viewer.locator('h2')).toContainText('luce_on_v2.svg');
  expect(await treeFilter.evaluate((i: HTMLInputElement) => i.selectionStart)).toBe(1);
  await treeFilter.fill('');
  await viewer.locator('.stage img').click();
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  await expect(gallery).toBeVisible();

  // Rinominata l'immagine aperta: il visore si chiude invece di mostrarne un'altra.
  await gallery.locator('.card', { hasText: 'luce_on.svg' }).click();
  await gallery.locator('.viewer .stage').click({ button: 'right' });
  await menuItem(page, 'Rinomina').click();
  await page.locator('editha-dialog input').fill('luce_z.svg');
  await dialogButton(page, 'Rinomina').click();
  await expect(viewer).toHaveCount(0);
  await expect(gallery.locator('.card .name')).toHaveText(['luce_on_v2.svg', 'luce_z.svg']);

  // Tasto destro su una miniatura: i comandi del file; la galleria segue la rinomina.
  await gallery.locator('.search input').fill('');
  await gallery.locator('.card', { hasText: 'porta.svg' }).click({ button: 'right' });
  await menuItem(page, 'Rinomina').click();
  await page.locator('editha-dialog input').fill('portone.svg');
  await dialogButton(page, 'Rinomina').click();
  await expect(gallery.locator('.card .name')).toHaveText(['luce_on_v2.svg', 'luce_z.svg', 'portone.svg']);

  await gallery.locator('header h2').click();
  await page.keyboard.press('Escape');
  await expect(gallery).toHaveCount(0);
});

test('UI – la × svuota i campi di filtro e ricerca', async ({ page }) => {
  const filter = page.locator('editha-file-tree .filter input');
  const clear = page.locator('editha-file-tree .filter .clear-btn');
  await expect(clear).toHaveCount(0);
  await filter.fill('nessun-file-si-chiama-cosi');
  await expect(page.locator('editha-file-tree')).toContainText('Nessun file corrisponde al filtro');
  await clear.click();
  await expect(filter).toHaveValue('');
  await expect(filter).toBeFocused();
  await expect(clear).toHaveCount(0);
  await expect(row(page, 'configuration.yaml')).toBeVisible();

  // Anche nella ricerca in tutti i file.
  await page.keyboard.press('Control+Shift+F');
  const query = page.locator('editha-search-panel .box .input');
  await query.fill('qualcosa');
  await page.locator('editha-search-panel .toggle.clear').click();
  await expect(query).toHaveValue('');
});

test('UI – cerca e sostituisci: il pulsante resta acceso e un secondo clic chiude', async ({ page }) => {
  await openFile(page, 'tabs/a.yaml');
  const button = page.locator('editha-toolbar button[title^="Cerca e sostituisci"]');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await button.click();
  await expect(page.locator('.cm-search')).toBeVisible();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await button.click();
  await expect(page.locator('.cm-search')).toHaveCount(0);
  await expect(button).toHaveAttribute('aria-pressed', 'false');
});

test('UI – anteprima template ed elenco dei problemi: un secondo clic chiude', async ({ page }) => {
  await openFile(page, 'cerca/due.yaml');
  await page.locator('.cm-line', { hasText: 'value:' }).click();
  await page.keyboard.press('End');
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
  const template = page.locator('editha-toolbar button[title^="Anteprima template"]');
  await template.click();
  await expect(page.locator('editha-template-panel')).toBeVisible();
  await expect(template).toHaveAttribute('aria-pressed', 'true');
  await template.click();
  await expect(page.locator('editha-template-panel')).toHaveCount(0);
  await expect(template).toHaveAttribute('aria-pressed', 'false');

  await openFile(page, 'entita/sbagliata.yaml');
  const problems = page.locator('editha-status-bar button.problems');
  await problems.click();
  await expect(page.locator('.cm-panel-lint')).toBeVisible();
  await expect(problems).toHaveAttribute('aria-pressed', 'true');
  await problems.click();
  await expect(page.locator('.cm-panel-lint')).toHaveCount(0);
  await expect(problems).toHaveAttribute('aria-pressed', 'false');
});

test('SEC-8 – le cartelle protette si leggono ma non si modificano', async ({ page }) => {
  await page.locator('editha-file-tree button[data-action="toggle-system"]').click();
  await openFile(page, '.storage/core.config');
  await expect(page.locator('editha-status-bar')).toContainText('Sola lettura');
  await expect(page.locator('editha-toolbar button[title^="Salva ("]')).toBeDisabled();
  await row(page, '.storage').click({ button: 'right' });
  await expect(menuItem(page, 'Elimina')).toBeDisabled();
});

const fakeHaCalls = async (): Promise<string[]> => (await fetch('http://127.0.0.1:8097/_calls')).json();

test.describe('Home Assistant', () => {
  test('HA-2 – pannello Inserisci: cerca un\'entità e la inserisce al cursore', async ({ page }) => {
    await openFile(page, 'tabs/a.yaml');
    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('luce: ');
    await page.locator('editha-toolbar button[title^="Inserisci"]').click();
    const panel = page.locator('editha-insert-panel');
    await panel.locator('.search input').fill('cucina');
    await expect(panel.locator('.item')).toHaveCount(1);
    await expect(panel.locator('.item .state')).toHaveText('on');
    await panel.locator('.item').click();
    await expect(editor(page)).toContainText('luce: light.cucina');
  });

  test('HA-2 – autocompletamento delle entità scrivendo "dominio."', async ({ page }) => {
    await openFile(page, 'tabs/b.yaml');
    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('entity_id: sensor.');
    const option = page.locator('.cm-tooltip-autocomplete li', { hasText: 'sensor.temperatura' });
    await expect(option).toBeVisible();
    await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('21.5 °C');
    // CodeMirror ignora l'Invio nei primi istanti dopo l'apertura dei suggerimenti.
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await expect(editor(page)).toContainText('entity_id: sensor.temperatura');
  });

  test('HA-11 – entità sconosciuta: avviso con la correzione proposta', async ({ page }) => {
    await openFile(page, 'tabs/b.yaml');
    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('entity_id: light.cucin');
    await page.keyboard.press('Escape');
    const warning = page.locator('.cm-lintRange-warning', { hasText: 'light.cucin' });
    await expect(warning).toBeVisible();
    await warning.hover();
    const tooltip = page.locator('.cm-tooltip-hover .cm-diagnostic-warning');
    await expect(tooltip).toContainText('«light.cucin» non è tra le entità attive del tuo Home Assistant. Forse intendevi «light.cucina»?');
    await tooltip.locator('.cm-diagnosticAction', { hasText: 'Sostituisci con light.cucina' }).click();
    await expect(editor(page)).toContainText('entity_id: light.cucina');
    await expect(page.locator('.cm-lintRange-warning')).toHaveCount(0);
  });

  test('HA-11 – l\'avviso compare anche aprendo un file, senza scrivere', async ({ page }) => {
    await openFile(page, 'entita/sbagliata.yaml');
    await expect(page.locator('.cm-lintRange-warning', { hasText: 'light.soggiorn' })).toBeVisible();
    await expect(page.locator('editha-status-bar')).toContainText('1 avviso');
  });

  test('HA-12 – attributi e stati: niente menu scrivendo, Ctrl+Spazio e riquadro nel pannello', async ({ page }) => {
    await openFile(page, 'tabs/c.yaml');
    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('- condition: state\n  entity_id: climate.salotto\n  attribute: hv');
    await page.keyboard.type('a');
    const list = page.locator('.cm-tooltip-autocomplete');
    // Mentre si scrive non compare niente: solo a richiesta.
    await page.waitForTimeout(400);
    await expect(list).toHaveCount(0);
    await page.keyboard.press('Control+Space');
    await expect(list.locator('li', { hasText: 'hvac_action' })).toBeVisible();
    await expect(list.locator('li', { hasText: 'hvac_modes' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Riquadro nel pannello Inserisci: l'entità del blocco, stati e attributi; un clic inserisce.
    await page.keyboard.insertText('\n- trigger: state\n  entity_id: climate.salotto\n  to: ');
    await page.locator('editha-toolbar button[title^="Inserisci"]').click();
    const card = page.locator('editha-insert-panel .ctx');
    await expect(card).toContainText('Termostato');
    await expect(card).toContainText('dopo «to:» → inserisce qui');
    await expect(card.locator('.chip.cur')).toContainText('heat');
    await card.locator('.chip', { hasText: /^off$/ }).click();
    await expect(editor(page)).toContainText('to: "off"');
    // Secondo clic con il cursore dopo le virgolette chiuse: sostituisce tutto il valore.
    await card.locator('.chip', { hasText: /^cool$/ }).click();
    await expect(editor(page)).toContainText('to: cool');
    await expect(editor(page)).not.toContainText('"off"');
    // Fuori dal blocco di un'entità il riquadro sparisce.
    await page.keyboard.insertText('\nnome: prova');
    await expect(card).toHaveCount(0);

    // Lampadina spenta: niente riquadro, niente Ctrl+Spazio, niente avviso per le entità sconosciute.
    const button = page.locator('editha-toolbar button[title^="Aiuti di Home Assistant"]');
    await page.keyboard.insertText('\nx:\n  entity_id: light.cucin');
    await expect(page.locator('.cm-lintRange-warning', { hasText: 'light.cucin' })).toBeVisible();
    await expect(card).toHaveCount(0);
    await page.keyboard.insertText('\n- entity_id: climate.salotto\n  attribute: ');
    await expect(card).toBeVisible();
    await button.click();
    await expect(card).toHaveCount(0);
    await expect(page.locator('.cm-lintRange-warning', { hasText: 'light.cucin' })).toHaveCount(0);
    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Control+Space');
    await page.waitForTimeout(400);
    await expect(list.locator('li', { hasText: 'hvac_action' })).toHaveCount(0);
    // Riaccesi (l'impostazione resta salvata per gli altri test).
    await page.keyboard.press('Escape');
    await button.click();
    await expect(page.locator('.cm-lintRange-warning', { hasText: 'light.cucin' })).toBeVisible();
    await expect(card).toBeVisible();
  });

  test('Snippet predefiniti e personali', async ({ page }) => {
    await openFile(page, 'tabs/c.yaml');
    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.locator('editha-toolbar button[title^="Inserisci"]').click();
    const panel = page.locator('editha-insert-panel');
    await panel.locator('.tabs button', { hasText: 'Snippet' }).click();
    await panel.locator('.item', { hasText: 'Trigger: orario' }).click();
    await expect(editor(page)).toContainText('- trigger: time');
    await expect(editor(page)).toContainText('at: "07:00:00"');

    // Salva la selezione come snippet personale, poi lo elimina.
    await editor(page).click();
    await page.keyboard.press('Control+a');
    await panel.locator('footer button').click();
    await page.locator('editha-dialog input').fill('Il mio snippet');
    await dialogButton(page, 'Salva').click();
    await expect(panel.locator('.item', { hasText: 'Il mio snippet' })).toBeVisible();

    // Modifica nome e testo.
    await panel.locator('.row', { hasText: 'Il mio snippet' }).locator('button[title="Modifica snippet"]').click();
    const editorDialog = page.locator('editha-snippet-editor dialog[open]');
    await editorDialog.locator('input').fill('Snippet rinominato');
    await editorDialog.locator('textarea').fill('modificato: si');
    await editorDialog.locator('button[type="submit"]').click();
    await expect(editorDialog).toHaveCount(0);
    const renamed = panel.locator('.row', { hasText: 'Snippet rinominato' });
    await expect(renamed).toContainText('modificato: si');

    await renamed.locator('button[title="Elimina snippet"]').click();
    await dialogButton(page, 'Elimina').click();
    await expect(panel.locator('.item', { hasText: 'Snippet rinominato' })).toHaveCount(0);
  });

  test('ACT-1 e ACT-4 – configurazione con errori: verifica li mostra, il riavvio viene bloccato', async ({ page }) => {
    await mkdir(path.join(configDir, 'check'), { recursive: true });
    await writeFile(path.join(configDir, 'check/rotto.yaml'), 'rotto: [\n');
    try {
      await page.locator('editha-toolbar button[title^="Home Assistant"]').click();
      await menuItem(page, 'Verifica configurazione').click();
      await expect(page.locator('editha-dialog h2')).toHaveText('Configurazione non valida');
      await expect(page.locator('editha-dialog pre')).toContainText('check/rotto.yaml');
      await dialogButton(page, 'Chiudi').click();

      await page.locator('editha-toolbar button[title^="Home Assistant"]').click();
      await menuItem(page, 'Riavvia Home Assistant').click();
      await dialogButton(page, 'Riavvia').click();
      await expect(page.locator('editha-dialog h2')).toHaveText('Configurazione non valida');
      await dialogButton(page, 'Chiudi').click();
      expect((await fakeHaCalls()).filter((c) => c.includes('/services/homeassistant/restart'))).toHaveLength(0);
    } finally {
      await rm(path.join(configDir, 'check'), { recursive: true, force: true });
    }
  });

  test('ACT-2 / FEP #16 – ricarica YAML: esito reale da Home Assistant', async ({ page }) => {
    await page.locator('editha-toolbar button[title^="Home Assistant"]').click();
    await menuItem(page, 'Ricarica configurazione YAML').click();
    await expect(page.locator('editha-toasts')).toContainText('Configurazione YAML ricaricata');
    expect(await fakeHaCalls()).toContain('POST /api/services/homeassistant/reload_all');
  });

  test('Colonna dei numeri di riga compatta anche su desktop', async ({ page }) => {
    await openFile(page, 'long/lungo.yaml');
    const gutter = await page.locator('editha-editor-pane .cm-gutters').evaluate((e) => e.getBoundingClientRect().width);
    expect(gutter).toBeLessThan(52);
  });
});

test('Editha irraggiungibile: banner con "Ricarica", che sparisce da solo quando torna', async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort());
  await row(page, 'configuration.yaml').click();
  const banner = page.locator('editha-app .banner');
  await expect(banner).toContainText('EDITHA non risponde');
  await expect(banner.locator('button')).toHaveText('Ricarica la pagina');
  await page.unroute('**/api/**');
  await expect(banner).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('editha-toasts')).toContainText('Connessione con EDITHA ripristinata');
});

test.describe('Upload e download (FS-6)', () => {
  test('scarica un file e una cartella come zip', async ({ page }) => {
    await row(page, 'configuration.yaml').click({ button: 'right' });
    const [file] = await Promise.all([page.waitForEvent('download'), menuItem(page, 'Scarica sul PC').click()]);
    expect(file.suggestedFilename()).toBe('configuration.yaml');
    expect(await readFile((await file.path())!, 'utf8')).toBe(await disk('configuration.yaml'));

    await row(page, 'tabs').click({ button: 'right' });
    const [zip] = await Promise.all([page.waitForEvent('download'), menuItem(page, 'Scarica come zip').click()]);
    expect(zip.suggestedFilename()).toBe('tabs.zip');
    const bytes = await readFile((await zip.path())!);
    expect(bytes.subarray(0, 4).toString('hex')).toBe('504b0304');
  });

  test('carica file dal PC nella cartella selezionata, chiedendo prima di sostituire', async ({ page }) => {
    await openFile(page, 'upload/esistente.yaml');
    await row(page, 'upload').click(); // chiude la cartella
    await row(page, 'upload').click(); // la riapre, resta selezionata
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('editha-file-tree button[data-action="upload"]').click(),
    ]);
    await chooser.setFiles([
      { name: 'nuovo.yaml', mimeType: 'text/yaml', buffer: Buffer.from('nuovo: si\n') },
      { name: 'esistente.yaml', mimeType: 'text/yaml', buffer: Buffer.from('aggiornato: 2\n') },
    ]);
    await expect(page.locator('editha-dialog h2')).toHaveText('File già presente');
    await dialogButton(page, 'Sostituisci').click();
    await expect(page.locator('editha-toasts')).toContainText('Caricati 2 file');
    await expect(row(page, 'upload/nuovo.yaml')).toBeVisible();
    expect(await disk('upload/nuovo.yaml')).toBe('nuovo: si\n');
    expect(await disk('upload/esistente.yaml')).toBe('aggiornato: 2\n');
    // La tab aperta mostra subito il nuovo contenuto.
    await expect(editor(page)).toContainText('aggiornato: 2');
  });

  test('carica un file trascinandolo dal PC su una cartella dell\'albero', async ({ page }) => {
    const target = row(page, 'drop');
    const dataTransfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['trascinato: true\n'], 'trascinato.yaml', { type: 'text/yaml' }));
      return dt;
    });
    await target.dispatchEvent('dragover', { dataTransfer });
    await expect(page.locator('editha-file-tree .drop-hint')).toContainText('/config/drop');
    await target.dispatchEvent('drop', { dataTransfer });
    await expect(page.locator('editha-toasts')).toContainText('Caricato trascinato.yaml');
    expect(await disk('drop/trascinato.yaml')).toBe('trascinato: true\n');
  });
});

test('Lingua: passa all\'inglese dal menu e la scelta resta dopo il rientro', async ({ page, request }) => {
  await page.locator('editha-toolbar button.lang').click();
  await menuItem(page, 'English').click();
  await expect(page.locator('editha-toolbar button.lang')).toHaveText('EN');
  await expect(page.locator('editha-file-tree header')).toHaveAttribute('aria-label', 'File explorer');
  await expect(page.locator('editha-status-bar')).toContainText('No file open');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.locator('editha-file-tree header')).toHaveAttribute('aria-label', 'File explorer');
  await openFile(page, 'configuration.yaml');
  await expect(page.locator('editha-status-bar')).toContainText('Ln 1, Col 1');
  await editor(page).click();
  await page.keyboard.press('Control+f');
  await expect(page.locator('.cm-search input[name=search]')).toHaveAttribute('placeholder', 'Find');
  await request.post('api/settings', { data: { language: 'it' } });
});

test('Lingua: il pannello di ricerca dell\'editor è in italiano', async ({ page }) => {
  await openFile(page, 'configuration.yaml');
  await editor(page).click();
  await page.keyboard.press('Control+f');
  await expect(page.locator('.cm-search input[name=search]')).toHaveAttribute('placeholder', 'Cerca');
});

test.describe('Cronologia e duplicazione', () => {
  test('BK-2/3/4 – confronta una versione e la ripristina; il ripristino si annulla', async ({ page }) => {
    await openFile(page, 'history/luci.yaml');
    for (const value of ['accesa', 'blu']) {
      await editor(page).click();
      await page.keyboard.press('Control+a');
      await page.keyboard.type(`luce: ${value}\n`);
      await page.keyboard.press('Control+s');
      await expect(activeTab(page)).not.toHaveClass(/dirty/);
    }
    expect(await disk('history/luci.yaml')).toBe('luce: blu\n');

    await page.locator('editha-toolbar button[title="Cronologia del file"]').click();
    const panel = page.locator('editha-history-panel');
    const versions = panel.locator('.version');
    await expect(versions).toHaveCount(2);
    await expect(versions.first()).toContainText('Prima di un salvataggio');
    // Confronto affiancato: a sinistra la versione, a destra il contenuto attuale.
    await expect(panel.locator('.cm-merge-a')).toContainText('luce: accesa');
    await expect(panel.locator('.cm-merge-b')).toContainText('luce: blu');

    await versions.nth(1).click();
    await expect(panel.locator('.cm-merge-a')).toContainText('luce: spenta');
    await panel.locator('button[data-action="restore"]').click();
    await dialogButton(page, 'Ripristina questa versione').click();
    await expect(panel).toHaveCount(0);
    await expect(editor(page)).toContainText('luce: spenta');
    expect(await disk('history/luci.yaml')).toBe('luce: spenta\n');

    // Il contenuto sostituito è finito nella cronologia.
    await page.locator('editha-toolbar button[title="Cronologia del file"]').click();
    await expect(versions.first()).toContainText('Prima di un ripristino');
    // Se il pannello aperto passa a un altro file, l'elenco è quello del nuovo file.
    await panel.evaluate((el: HTMLElement & { path: string }) => (el.path = 'tabs/a.yaml'));
    await expect(panel).toContainText('Nessuna versione precedente');
    await expect(versions).toHaveCount(0);
    await panel.evaluate((el: HTMLElement & { path: string }) => (el.path = 'history/luci.yaml'));
    await expect(versions).toHaveCount(3);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  });

  test('FS-8 – duplica un file YAML in .bak, che HA non carica; un nome .yaml va confermato', async ({ page }) => {
    await row(page, 'dup').click();
    await row(page, 'dup/originale.yaml').click({ button: 'right' });
    await menuItem(page, 'Duplica').click();
    const input = page.locator('editha-dialog input');
    await expect(input).toHaveValue('originale_copia.yaml.bak');
    await dialogButton(page, 'Crea').click();
    await expect(row(page, 'dup/originale_copia.yaml.bak')).toBeVisible();
    await expect(activeTab(page)).toHaveAttribute('data-path', 'dup/originale_copia.yaml.bak');
    // La copia .bak si legge comunque come YAML.
    await expect(page.locator('editha-status-bar')).toContainText('YAML');
    expect(await disk('dup/originale_copia.yaml.bak')).toBe('copia: no\n');
    expect(await disk('dup/originale.yaml')).toBe('copia: no\n');

    await row(page, 'dup/originale.yaml').click({ button: 'right' });
    await menuItem(page, 'Duplica').click();
    await input.fill('altra.yaml');
    await dialogButton(page, 'Crea').click();
    await expect(page.locator('editha-dialog dialog[open]')).toContainText('caricherà sia l\'originale sia la copia');
    await dialogButton(page, 'Annulla').click();
    await expect(row(page, 'dup/altra.yaml')).toHaveCount(0);
  });
});

test.describe('Bozze (ED-14)', () => {
  // Altri test possono lasciare file modificati e quindi bozze: qui si parte senza.
  test.beforeEach(async ({ request }) => {
    const drafts = (await (await request.get('api/drafts')).json()).drafts as { path: string; client?: string }[];
    for (const d of drafts) {
      await request.delete(`api/draft?path=${encodeURIComponent(d.path)}${d.client ? `&client=${encodeURIComponent(d.client)}` : ''}`);
    }
  });

  async function typeAndLeave(
    page: Page,
    request: import('@playwright/test').APIRequestContext,
    p: string,
    meanwhile?: () => Promise<unknown>,
  ) {
    await openFile(page, p);
    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('bozza: si\n');
    await expect
      .poll(async () => (await (await request.get('api/drafts')).json()).drafts.map((d: { path: string }) => d.path))
      .toEqual([p]);
    const context = page.context();
    await page.close();
    await meanwhile?.();
    const again = await context.newPage();
    await again.goto('./');
    await expect(again.locator('editha-dialog dialog[open]')).toContainText('Modifiche non salvate');
    await expect(again.locator('editha-dialog dialog[open]')).toContainText(p);
    return again;
  }

  test('chiudendo la pagina senza salvare, alla riapertura le modifiche si recuperano', async ({ page, request }) => {
    const again = await typeAndLeave(page, request, 'drafts/recupera.yaml');
    await dialogButton(again, 'Recupera').click();
    await expect(activeTab(again)).toHaveAttribute('data-path', 'drafts/recupera.yaml');
    await expect(activeTab(again)).toHaveClass(/dirty/);
    await expect(editor(again)).toContainText('bozza: si');
    expect(await disk('drafts/recupera.yaml')).toBe('stato: salvato\n');

    await editor(again).click();
    await again.keyboard.press('Control+s');
    await expect(activeTab(again)).not.toHaveClass(/dirty/);
    expect(await disk('drafts/recupera.yaml')).toBe('stato: salvato\nbozza: si\n');
    await expect.poll(async () => (await (await request.get('api/drafts')).json()).drafts.length).toBe(0);
  });

  test('le modifiche recuperate si possono scartare', async ({ page, request }) => {
    const again = await typeAndLeave(page, request, 'drafts/scarta.yaml');
    await dialogButton(again, 'Scarta').click();
    await expect.poll(async () => (await (await request.get('api/drafts')).json()).drafts.length).toBe(0);
    expect(await disk('drafts/scarta.yaml')).toBe('stato: salvato\n');
    await expect(again.locator('editha-tab-bar .tab.dirty')).toHaveCount(0);
  });

  test('con Esc la bozza resta; modificando il file si chiede se recuperarla', async ({ page, request }) => {
    const again = await typeAndLeave(page, request, 'drafts/dopo.yaml');
    await again.keyboard.press('Escape');
    await expect(again.locator('editha-dialog dialog[open]')).toHaveCount(0);
    await expect(activeTab(again)).toHaveAttribute('data-path', 'drafts/dopo.yaml');
    await editor(again).click();
    await again.keyboard.press('Control+Home');
    // Si continua a scrivere: i tasti battuti per inerzia non scelgono nella finestra.
    await again.keyboard.type('# a');
    // Tab (rientro in YAML), spazio e Invio battuti per inerzia non scelgono «Scarta».
    await again.keyboard.press('Tab');
    await again.keyboard.type(' x ');
    await again.keyboard.press('Enter');
    // La bozza vecchia non è stata sostituita: si chiede alla prima modifica.
    await expect(again.locator('editha-dialog dialog[open]')).toContainText('ancora una bozza');
    expect((await (await request.get('api/drafts')).json()).drafts[0].content).toBe('stato: salvato\nbozza: si\n');
    await dialogButton(again, 'Recupera').click();
    await expect(editor(again)).toContainText('bozza: si');
    await expect(activeTab(again)).toHaveClass(/dirty/);
    // Recuperata: la bozza passa a questa finestra, e salvando sparisce.
    await again.keyboard.press('Control+s');
    await expect(activeTab(again)).not.toHaveClass(/dirty/);
    await expect.poll(async () => (await (await request.get('api/drafts')).json()).drafts.length).toBe(0);
  });

  test('due finestre aperte: la seconda non propone né sovrascrive le bozze della prima', async ({ page, request }) => {
    const p = 'drafts/due-finestre.yaml';
    await openFile(page, p);
    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('prima: si\n');
    await expect.poll(async () => (await (await request.get('api/drafts')).json()).drafts.length).toBe(1);

    // Seconda finestra (un'altra scheda): nessuna domanda sulle bozze della prima, ancora aperta.
    const other = await page.context().newPage();
    await other.goto('./');
    await expect(other.locator('editha-file-tree')).toBeVisible();
    await other.waitForTimeout(1500);
    await expect(other.locator('editha-dialog dialog[open]')).toHaveCount(0);

    // Anche la seconda modifica lo stesso file: le due bozze restano separate.
    await openFile(other, p);
    await editor(other).click();
    await other.keyboard.press('Control+End');
    await other.keyboard.type('seconda: si\n');
    await expect.poll(async () => (await (await request.get('api/drafts')).json()).drafts.length).toBe(2);
    const contents = (await (await request.get('api/drafts')).json()).drafts.map((d: { content: string }) => d.content).sort();
    expect(contents).toEqual(['stato: salvato\nprima: si\n', 'stato: salvato\nseconda: si\n']);

    // Pulizia: le due finestre scartano le proprie modifiche.
    for (const w of [page, other]) {
      await w.keyboard.press('Alt+w');
      await dialogButton(w, 'Non salvare').click();
    }
    await expect.poll(async () => (await (await request.get('api/drafts')).json()).drafts.length).toBe(0);
    await other.close();
  });

  test('due finestre recuperano insieme la stessa bozza: la ottiene una sola', async ({ page, request }) => {
    const p = 'drafts/conteso.yaml';
    const etag = (await (await request.get(`api/file?path=${encodeURIComponent(p)}`)).json()).etag;
    // Bozza lasciata da una finestra che si è chiusa.
    await request.post('api/drafts/alive', { data: { client: 'chiusa', closing: true } });
    await request.put('api/draft', { data: { path: p, content: 'stato: salvato\nrecuperata: si\n', etag, client: 'chiusa' } });

    const second = await page.context().newPage();
    await Promise.all([page.goto('./'), second.goto('./')]);
    for (const w of [page, second]) await expect(w.locator('editha-dialog dialog[open]')).toContainText(p);
    await Promise.all([dialogButton(page, 'Recupera').click(), dialogButton(second, 'Recupera').click()]);

    const recovered = async (w: Page) => (await w.locator(`editha-tab-bar .tab.dirty[data-path="${p}"]`).count()) > 0;
    await expect.poll(async () => [await recovered(page), await recovered(second)].filter(Boolean).length).toBe(1);
    const loser = (await recovered(page)) ? second : page;
    await expect(loser.locator('editha-toasts')).toContainText('già state recuperate o scartate');
    const drafts = (await (await request.get('api/drafts')).json()).drafts as { client: string }[];
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.client).not.toBe('chiusa');

    // Pulizia.
    const winner = loser === page ? second : page;
    await winner.keyboard.press('Control+s');
    await expect.poll(async () => (await (await request.get('api/drafts')).json()).drafts.length).toBe(0);
    await second.close();
  });

  test('la bozza di un file cancellato nel frattempo si può ricreare', async ({ page, request }) => {
    // Cancellato da fuori mentre la pagina è chiusa.
    const again = await typeAndLeave(page, request, 'drafts/sparisce.yaml', () =>
      rm(path.join(configDir, 'drafts/sparisce.yaml')),
    );
    await dialogButton(again, 'Recupera').click();
    await expect(again.locator('editha-dialog dialog[open]')).toContainText('non esiste più');
    await dialogButton(again, 'Ricrea il file').click();
    await expect(activeTab(again)).toHaveAttribute('data-path', 'drafts/sparisce.yaml');
    await expect.poll(() => disk('drafts/sparisce.yaml')).toBe('stato: salvato\nbozza: si\n');
    await expect.poll(async () => (await (await request.get('api/drafts')).json()).drafts.length).toBe(0);
  });
});

test.describe('Vista divisa (ED-17)', () => {
  const side = (page: Page) => page.locator('editha-side-pane .cm-content');
  const sideSelect = (page: Page) => page.locator('editha-app .side-head select');

  test('lo stesso file in due colonne: le modifiche passano da una all\'altra e si salva la tab', async ({ page }) => {
    await openFile(page, 'split/sinistra.yaml');
    await page.locator('editha-toolbar button[title="Vista divisa in due colonne"]').click();
    await expect(side(page)).toContainText('lato: sinistra');
    await expect(sideSelect(page)).toHaveValue('split/sinistra.yaml');
    // L'elenco aperto ha colori propri, leggibili anche nel tema scuro (Windows usa quelli delle opzioni).
    const colors = await sideSelect(page).evaluate((el) => {
      const o = getComputedStyle(el.querySelector('option')!);
      return [o.backgroundColor, o.color];
    });
    expect(colors[0]).not.toBe('rgba(0, 0, 0, 0)');
    expect(colors[0]).not.toBe(colors[1]);

    await side(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('da_destra: si\n');
    await expect(editor(page)).toContainText('da_destra: si');
    await expect(activeTab(page)).toHaveClass(/dirty/);

    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('da_sinistra: si\n');
    await expect(side(page)).toContainText('da_sinistra: si');

    await side(page).click();
    await page.keyboard.press('Control+s');
    await expect(activeTab(page)).not.toHaveClass(/dirty/);
    expect(await disk('split/sinistra.yaml')).toBe('lato: sinistra\nda_destra: si\nda_sinistra: si\n');
  });

  test('"Apri a destra" affianca un altro file; la scelta resta rientrando', async ({ page }) => {
    await openFile(page, 'split/fermo.yaml');
    await row(page, 'split/destra.yaml').click({ button: 'right' });
    await menuItem(page, 'Apri a destra').click();
    await expect(side(page)).toContainText('lato: destra');
    await expect(editor(page)).toContainText('lato: fermo');
    await expect(activeTab(page)).toHaveAttribute('data-path', 'split/fermo.yaml');

    // Salva agisce sulla colonna usata per ultima.
    await side(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('modificato: a_destra\n');
    await expect(tab(page, 'split/destra.yaml')).toHaveClass(/dirty/);
    await expect(activeTab(page)).not.toHaveClass(/dirty/);
    await page.keyboard.press('Control+s');
    await expect(tab(page, 'split/destra.yaml')).not.toHaveClass(/dirty/);
    expect(await disk('split/destra.yaml')).toBe('lato: destra\nmodificato: a_destra\n');
    expect(await disk('split/fermo.yaml')).toBe('lato: fermo\n');

    await page.waitForTimeout(800);
    await page.reload();
    await expect(side(page)).toContainText('lato: destra');
    await expect(editor(page)).toContainText('lato: fermo');

    await page.locator('editha-app .side-head button').click();
    await expect(page.locator('editha-app .side')).toBeHidden();
  });
});

test('Informazioni: autore, versione e licenza', async ({ page }) => {
  await page.locator('editha-toolbar button[title="Informazioni su EDITHA"]').click();
  const about = page.locator('editha-about-dialog dialog[open]');
  await expect(about).toContainText('Trizompa');
  await expect(about).toContainText('MIT');
  await expect(about.locator('[data-field="version"]')).toHaveText(/^\d+\.\d+\.\d+$/);
  await about.locator('button', { hasText: 'Chiudi' }).click();
  await expect(about).toHaveCount(0);
});

test('BK-7 – spazio della cronologia: totale e file per file, dal pannello Cronologia', async ({ page }) => {
  // Due salvataggi: due versioni di spazio/pesante.yaml.
  await openFile(page, 'spazio/pesante.yaml');
  for (const line of ['b: 2', 'c: 3']) {
    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(`${line}\n`);
    await page.keyboard.press('Control+s');
    await expect(activeTab(page)).not.toHaveClass(/dirty/);
  }

  await openSpaceDialog(page);
  const space = page.locator('editha-history-space dialog[open]');
  await expect(space).toContainText('La cronologia occupa');
  const row = space.locator('tr', { hasText: 'spazio/pesante.yaml' });
  await expect(row.locator('td').nth(1)).toHaveText('2');
  await space.locator('button', { hasText: 'Chiudi' }).click();
  await expect(space).toHaveCount(0);

  // La cronologia è rimasta aperta: si riapre dal suo pulsante.
  await page.locator('editha-history-panel button[title="Spazio occupato dalla cronologia"]').click();
  await expect(space).toContainText('spazio/pesante.yaml');
});

test('Controllo YAML: il conteggio nella barra apre l\'elenco dei problemi con le spiegazioni', async ({ page }) => {
  await openFile(page, 'lint/problemi.yaml');
  const count = page.locator('editha-status-bar button.problems');
  await expect(count).toContainText('2 avvisi');
  await count.click();
  const panel = page.locator('editha-editor-pane .cm-panel-lint');
  await expect(panel).toContainText('«on» senza virgolette');
  await expect(panel).toContainText('Riga 3');
  await expect(panel).toContainText('Scrivi «service: light.turn_on»');
  // Un clic su un problema porta il cursore alla sua riga.
  await panel.locator('li', { hasText: 'Riga 5' }).click();
  await expect(page.locator('editha-status-bar')).toContainText('Riga 5');
});

test.describe('Collegamenti !include e !secret (HA-4, HA-5)', () => {
  const lineOf = (page: Page, text: string) => page.locator('editha-editor-pane .cm-line', { hasText: text });

  test('Ctrl+clic su !include apre il file; su !include_dir_… mostra la cartella', async ({ page }) => {
    await openFile(page, 'links/main.yaml');
    await lineOf(page, 'auto.yaml').locator('.cm-ha-link').click({ modifiers: ['Control'] });
    await expect(activeTab(page)).toHaveAttribute('data-path', 'links/auto.yaml');
    await expect(editor(page)).toContainText('alias: incluso');

    await tab(page, 'links/main.yaml').click();
    await lineOf(page, 'sensori').locator('.cm-ha-link').click({ modifiers: ['Control'] });
    await expect(row(page, 'links/sensori/a.yaml')).toBeVisible();
    await expect(row(page, 'links/sensori')).toHaveAttribute('aria-selected', 'true');
  });

  test('dopo !secret propone le chiavi (mai i valori); Ctrl+clic apre secrets.yaml sulla chiave', async ({ page }) => {
    await openFile(page, 'links/main.yaml');
    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('token: !secret chiave_');
    const list = page.locator('editha-editor-pane .cm-tooltip-autocomplete');
    await expect(list).toContainText('chiave_uno');
    await expect(list).toContainText('chiave_due');
    await expect(list).not.toContainText('valore_segreto');
    await page.keyboard.press('Escape');

    await lineOf(page, 'api_key').locator('.cm-ha-link').click({ modifiers: ['Control'] });
    await expect(activeTab(page)).toHaveAttribute('data-path', 'links/secrets.yaml');
    await expect(page.locator('editha-status-bar')).toContainText('Riga 2');
  });
});

test.describe('Sposta in… (FS-5)', () => {
  const picker = (page: Page) => page.locator('editha-folder-picker dialog[open]');
  const folder = (page: Page, f: string) => picker(page).locator(`.folder[data-folder="${f}"]`);

  test('sposta un file aperto in un\'altra cartella: la tab lo segue', async ({ page }) => {
    await openFile(page, 'move/da_spostare.yaml');
    await row(page, 'move/da_spostare.yaml').click({ button: 'right' });
    await menuItem(page, 'Sposta in…').click();
    await expect(folder(page, 'move')).toBeDisabled();
    await picker(page).locator('input').fill('dest');
    await expect(folder(page, 'tabs')).toHaveCount(0);
    await folder(page, 'move/dest').click();
    await picker(page).locator('button', { hasText: 'Sposta qui' }).click();
    await expect(row(page, 'move/dest/da_spostare.yaml')).toBeVisible();
    await expect(activeTab(page)).toHaveAttribute('data-path', 'move/dest/da_spostare.yaml');
    expect(await disk('move/dest/da_spostare.yaml')).toBe('spostato: si\n');
  });

  test('una cartella non si può spostare dentro sé stessa', async ({ page }) => {
    await row(page, 'move').click();
    await row(page, 'move/cartella').click({ button: 'right' });
    await menuItem(page, 'Sposta in…').click();
    await expect(folder(page, 'move/cartella')).toBeDisabled();
    await folder(page, '').click();
    await picker(page).locator('button', { hasText: 'Sposta qui' }).click();
    await expect(row(page, 'cartella')).toBeVisible();
    expect(await disk('cartella/dentro.yaml')).toBe('x: 1\n');
  });
});

test.describe('Ricerca in tutti i file (SR-1, SR-4)', () => {
  const panel = (page: Page) => page.locator('editha-search-panel');

  test('cerca in tutti i file e apre il risultato selezionando il testo trovato', async ({ page }) => {
    await expect(page.locator('editha-toolbar button[title^="Cerca in tutti i file"]')).toHaveCount(0);
    await page.locator('editha-file-tree button[title^="Cerca in tutti i file"]').click();
    await panel(page).locator('input').fill('ago_nel_pagliaio');
    await expect(panel(page)).toContainText('2 risultati in 1 file');
    await panel(page).locator('button[title="Maiuscole/minuscole"]').click();
    await expect(panel(page)).toContainText('1 risultato in 1 file');
    await panel(page).locator('.match[data-path="cerca/uno.yaml"]').first().click();
    await expect(activeTab(page)).toHaveAttribute('data-path', 'cerca/uno.yaml');
    await expect(page.locator('editha-status-bar')).toContainText('16 selez.');
    // Torna all'elenco dei file.
    await panel(page).locator('button[title="Torna all\'elenco dei file"]').click();
    await expect(row(page, 'cerca')).toBeVisible();
  });

  test('dove è usata un\'entità: dal pannello Inserisci, solo le parole intere', async ({ page }) => {
    await openFile(page, 'cerca/due.yaml');
    await page.locator('editha-toolbar button[title="Inserisci entità o snippet"]').click();
    const insert = page.locator('editha-insert-panel');
    await insert.locator('input').fill('cucina');
    await insert.locator('button[title="Dove è usata light.cucina"]').click();
    await expect(panel(page)).toContainText('Luce cucina');
    const hits = panel(page).locator('.match[data-path="cerca/due.yaml"]');
    // light.cucina e states.light.cucina sì, light.cucina_2 no.
    await expect(hits).toHaveCount(2);
  });
});

test('due Ctrl+S ravvicinati: niente falso conflitto, niente bozza rimasta', async ({ page, request }) => {
  // Salvataggi lenti, come su una rete lenta o un HA occupato.
  await page.route('**/api/file', async (route) => {
    if (route.request().method() === 'PUT') await new Promise((r) => setTimeout(r, 500));
    await route.continue();
  });
  await openFile(page, 'race/doppio.yaml');
  await editor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('primo: 1\n');
  await page.waitForTimeout(1200); // parte anche la bozza
  await page.keyboard.press('Control+s');
  await page.keyboard.type('secondo: 2\n');
  await page.keyboard.press('Control+s');
  await expect(activeTab(page)).not.toHaveClass(/dirty/, { timeout: 5000 });
  await expect(page.locator('editha-dialog dialog[open]')).toHaveCount(0);
  expect(await disk('race/doppio.yaml')).toBe('base: 1\nprimo: 1\nsecondo: 2\n');
  await expect.poll(async () => (await (await request.get('api/drafts')).json()).drafts.length).toBe(0);
});

test('icone MDI: dopo "mdi:" propone le icone con l\'anteprima', async ({ page }) => {
  await openFile(page, 'tabs/a.yaml');
  await editor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('icon: mdi:lightbulb-on-1');
  const list = page.locator('editha-editor-pane .cm-tooltip-autocomplete');
  await expect(list).toContainText('lightbulb-on-10');
  await expect(list.locator('.cm-mdi-preview svg').first()).toBeVisible();
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await expect(editor(page)).toContainText(/icon: mdi:lightbulb-on-1\d/);
});

test('SR-3 – sostituisci in più file: conferma, cronologia, tab aperte aggiornate, file non salvati saltati', async ({ page }) => {
  await openFile(page, 'sost/uno.yaml');
  await openFile(page, 'sost/aperto.yaml');
  await editor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('# non salvato\n');
  await tab(page, 'sost/uno.yaml').click();

  await page.locator('editha-file-tree button[title^="Cerca in tutti i file"]').click();
  const panel = page.locator('editha-search-panel');
  await panel.locator('button[title="Parola intera"]').click();
  await panel.locator('.box input').fill('light.vecchia');
  await expect(panel).toContainText('3 risultati in 3 file');
  await panel.locator('button[title="Sostituisci nei file"]').click();
  await panel.locator('.replace input').fill('light.nuova');
  await panel.locator('button[data-action="replace-all"]').click();
  const dialog = page.locator('editha-dialog dialog[open]');
  await expect(dialog).toContainText('aperto.yaml');
  await dialogButton(page, 'Sostituisci tutto').click();

  await expect.poll(() => disk('sost/due.yaml')).toBe('target: light.nuova\naltro: light.vecchia_2\n');
  await expect.poll(() => disk('sost/uno.yaml')).toBe('luce: light.nuova\n');
  expect(await disk('sost/aperto.yaml')).toBe('x: light.vecchia\n');
  // La tab aperta e non modificata mostra il testo nuovo; i risultati si aggiornano.
  await expect(editor(page)).toContainText('luce: light.nuova');
  await expect(panel).toContainText('1 risultato in 1 file');
});

test('BK-6 – confronta due file dal menu contestuale', async ({ page }) => {
  await row(page, 'confronta').click();
  await row(page, 'confronta/prima.yaml').click({ button: 'right' });
  await menuItem(page, 'Seleziona per il confronto').click();
  await row(page, 'confronta/dopo.yaml').click({ button: 'right' });
  await menuItem(page, 'Confronta con prima.yaml').click();
  const panel = page.locator('editha-compare-panel');
  await expect(panel.locator('.cm-merge-a')).toContainText('stanze: 3');
  await expect(panel.locator('.cm-merge-b')).toContainText('stanze: 4');
  await expect(panel).toContainText('confronta/prima.yaml');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
});

test.describe('telefono', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('UI-2 – colonna dei numeri compatta e righe spezzate allineate alla loro indentazione', async ({ page, request }) => {
    await request.post('api/settings', { data: { wordWrap: true } });
    await page.reload();
    await page.locator('editha-toolbar button[title^="Mostra"]').click();
    await row(page, 'long').click();
    await row(page, 'long/lungo.yaml').click();
    const gutter = await page.locator('editha-editor-pane .cm-gutters').evaluate((e) => e.getBoundingClientRect().width);
    expect(gutter).toBeLessThan(60);

    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('  descrizione: ' + 'parola '.repeat(20));
    const line = page.locator('editha-editor-pane .cm-line', { hasText: 'descrizione' });
    const box = await line.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()];
      return { first: rects[0]!.left, last: rects[rects.length - 1]!.left, lines: new Set(rects.map((r) => Math.round(r.top))).size };
    });
    expect(box.lines).toBeGreaterThan(1);
    // Il seguito della riga non riparte dal margine: resta più a destra dell'inizio della chiave.
    expect(box.last).toBeGreaterThan(box.first);
    await request.post('api/settings', { data: { wordWrap: false } });
  });

  test('pressione prolungata su un file apre il menu contestuale', async ({ page }) => {
    await page.locator('editha-toolbar button[title^="Mostra"]').click();
    await row(page, 'dup').click();
    const target = row(page, 'dup/telefono.yaml');
    const box = (await target.boundingBox())!;
    const point = { pointerType: 'touch', clientX: box.x + 20, clientY: box.y + 10, bubbles: true, composed: true };
    await target.dispatchEvent('pointerdown', point);
    await expect(menuItem(page, 'Cronologia')).toBeVisible();
    await target.dispatchEvent('pointerup', point);
    await menuItem(page, 'Duplica').click();
    await dialogButton(page, 'Crea').click();
    await expect(row(page, 'dup/telefono_copia.yaml.bak')).toBeAttached();
  });

  test('l\'editor non ha l\'effetto elastico che sposta la colonna dei numeri', async ({ page }) => {
    await page.locator('editha-toolbar button[title^="Mostra"]').click();
    await row(page, 'configuration.yaml').click();
    const scroller = page.locator('editha-editor-pane .cm-scroller');
    await expect(scroller).toHaveCSS('overscroll-behavior-x', 'none');
    expect(await page.evaluate(() => getComputedStyle(document.body).overscrollBehaviorX)).toBe('none');
  });

  test('con la tastiera aperta c\'è il pulsante per chiuderla, accanto al cursore', async ({ page }) => {
    await page.locator('editha-toolbar button[title^="Mostra"]').click();
    await row(page, 'configuration.yaml').click();
    const hide = page.locator('editha-editor-pane .cm-hide-keyboard button');
    await expect(hide).toHaveCount(0);
    await editor(page).tap();
    await expect(hide).toBeVisible();
    // Dentro lo schermo, sul lato destro (iOS sposta la pagina: la barra in alto non si vede).
    const box = (await hide.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.x).toBeGreaterThan(250);
    await hide.tap();
    await expect(hide).toHaveCount(0);
    expect(await editor(page).evaluate((el) => el.matches(':focus'))).toBe(false);
  });
});

test('FS-10 – immagini e PDF si aprono in una tab di anteprima', async ({ page }) => {
  await openFile(page, 'configuration.yaml');
  await row(page, 'anteprima').click();
  await row(page, 'anteprima/foto.png').click();
  const preview = page.locator('editha-preview-panel');
  await expect(preview).toBeVisible();
  // Piccola: mostrata a grandezza reale, centrata.
  await expect(preview.locator('header')).toContainText('3 × 2 px · 100%');
  const img = preview.locator('img');
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(3);
  await expect(activeTab(page)).toHaveAttribute('data-path', 'anteprima/foto.png');
  await expect(activeTab(page)).toHaveClass(/preview/);
  // Salva e annulla non agiscono sul file di testo nascosto.
  await expect(page.locator('editha-toolbar button[title^="Salva (Ctrl+S)"]')).toBeDisabled();

  // Il PDF riusa la stessa tab.
  await row(page, 'anteprima/manuale.pdf').click();
  await expect(preview.locator('iframe')).toHaveAttribute('src', /api\/preview\?path=anteprima%2Fmanuale\.pdf/);
  await expect(page.locator('editha-tab-bar .tab.preview')).toHaveCount(1);
  await expect(tab(page, 'anteprima/foto.png')).toHaveCount(0);

  // Si passa da una tab all'altra; l'anteprima resta tra le tab.
  await tab(page, 'configuration.yaml').click();
  await expect(preview).toHaveCount(0);
  await expect(tab(page, 'anteprima/manuale.pdf')).toBeVisible();
  await tab(page, 'anteprima/manuale.pdf').click();
  await expect(preview).toBeVisible();

  // Chiuse le tab di testo, resta l'anteprima; la sua X la chiude.
  await tab(page, 'configuration.yaml').locator('button.close').click();
  await expect(preview).toBeVisible();
  await tab(page, 'anteprima/manuale.pdf').locator('button.close').click();
  await expect(preview).toHaveCount(0);
  await expect(page.locator('editha-tab-bar .tab')).toHaveCount(0);

  // Esc chiude l'anteprima.
  await row(page, 'anteprima/foto.png').click();
  await expect(preview).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);

  // Un SVG si vede in anteprima, ma dal menu si apre anche come testo.
  await row(page, 'anteprima/icona.svg').click({ button: 'right' });
  await expect(menuItem(page, 'Apri a destra')).toHaveCount(1);
  await menuItem(page, 'Apri come testo').click();
  await expect(activeTab(page)).toHaveAttribute('data-path', 'anteprima/icona.svg');
  await expect(activeTab(page)).not.toHaveClass(/preview/);
  await expect(editor(page)).toContainText('<svg');
  // Immagini e PDF non si aprono a destra.
  await row(page, 'anteprima/foto.png').click({ button: 'right' });
  await expect(menuItem(page, 'Apri a destra')).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('ED-18 – schema del file: voci, salto alla riga, voce attiva, scelta ricordata', async ({ page, request }) => {
  await openFile(page, 'schema/automazioni.yaml');
  const button = page.locator('editha-toolbar button[title^="Schema del file"]');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await button.click();
  const panel = page.locator('editha-outline-panel');
  await expect(panel.locator('button.item')).toHaveText([/Luci al tramonto/, /Buonanotte/, /Porta aperta/]);
  // Un clic porta il cursore alla voce, che diventa quella attiva.
  await panel.locator('button.item', { hasText: 'Porta aperta' }).click();
  await expect(page.locator('editha-status-bar')).toContainText('Riga 9, col 1');
  await expect(panel.locator('button.item[aria-current="true"]')).toContainText('Porta aperta');
  // Lo schema segue il testo mentre si scrive.
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n- alias: Nuova\n');
  await expect(panel.locator('button.item')).toHaveCount(4);
  await page.keyboard.press('Control+s');
  await expect(activeTab(page)).not.toHaveClass(/dirty/);
  // Un file non YAML non ha schema.
  await openFile(page, 'schema/note.txt');
  await expect(panel).toContainText('Apri un file YAML');
  // La scelta resta dopo il rientro.
  await expect.poll(async () => (await (await request.get('api/settings')).json()).outlineVisible).toBe(true);
  await page.reload();
  await expect(page.locator('editha-outline-panel')).toBeVisible();
  await page.locator('editha-outline-panel button[title="Chiudi"]').click();
  await expect(page.locator('editha-outline-panel')).toHaveCount(0);
  await expect.poll(async () => (await (await request.get('api/settings')).json()).outlineVisible).toBe(false);
});

test('FS-1 – le cartelle vuote non hanno la freccia per espanderle', async ({ page }) => {
  await expect(row(page, 'sempre-vuota').locator('.chevron svg')).toHaveCount(0);
  await expect(row(page, 'tabs').locator('.chevron svg')).toHaveCount(1);
});

test('a capo di Windows (CRLF) conservati al salvataggio; un file misto si vede a righe normali', async ({ page }) => {
  await openFile(page, 'crlf/windows.yaml');
  await expect(editor(page).locator('.cm-line')).toHaveCount(3);
  await editor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('c: 3');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+s');
  await expect(activeTab(page)).not.toHaveClass(/dirty/);
  expect(await disk('crlf/windows.yaml')).toBe('a: 1\r\nb: 2\r\nc: 3\r\n');

  await openFile(page, 'crlf/misto.yaml');
  await expect(editor(page).locator('.cm-line')).toHaveCount(4);
});

test('HA-7 – anteprima del template sotto il cursore: risultato, errore di sintassi, errore di valutazione', async ({ page }) => {
  await openFile(page, 'template/auto.yaml');
  const panel = page.locator('editha-template-panel');
  const lineOf = (n: number) => editor(page).locator('.cm-line').nth(n - 1);

  // Cursore sul valore tra virgolette, con Alt+T.
  await lineOf(4).click();
  await page.keyboard.press('Alt+t');
  await expect(panel.locator('.ok pre')).toHaveText('on');
  await expect(panel.locator('.source')).toHaveText('auto.yaml, riga 4');

  // Blocco "|" con un {% if %} non chiuso, cursore sulla riga dell'if: errore di sintassi.
  await lineOf(10).click();
  await page.keyboard.press('Alt+t');
  await expect(panel.locator('.syntax .badge')).toHaveText(/Errore di sintassi/);
  await expect(panel.locator('.syntax pre')).toContainText('endif');
  await expect(panel.locator('.source')).toHaveText('auto.yaml, riga 9');

  // Errore di valutazione.
  await lineOf(11).click();
  await page.keyboard.press('Alt+t');
  await expect(panel.locator('.render pre')).toHaveText('ZeroDivisionError: division by zero');

  // Nessun template sulla riga: avviso, il pannello resta com'era. Esc lo chiude.
  await lineOf(1).click();
  await page.keyboard.press('Alt+t');
  await expect(page.locator('editha-toasts')).toContainText('Nessun template qui');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  // In secrets.yaml non parte niente.
  await openFile(page, 'links/secrets.yaml');
  await editor(page).click();
  await page.keyboard.press('Alt+t');
  await expect(page.locator('editha-toasts')).toContainText('non è disponibile in secrets.yaml');
  await expect(panel).toHaveCount(0);
});

test('HA-7 – pulsante nella barra, aggiornamento mentre si scrive, entità inesistenti, riga dell\'errore, Copia', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openFile(page, 'template/auto.yaml');
  const panel = page.locator('editha-template-panel');
  const lineOf = (n: number) => editor(page).locator('.cm-line').nth(n - 1);

  await lineOf(4).click();
  await page.locator('editha-toolbar button[aria-label="Anteprima template (Alt+T)"]').click();
  await expect(panel.locator('.ok pre')).toHaveText('on');
  await expect(panel.locator('.missing')).toHaveCount(0);

  // Copia il risultato.
  await panel.locator('button[data-action="template-copy"]').click();
  await expect(panel.locator('button[data-action="template-copy"]')).toContainText('Copiato');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('on');

  // Si scrive nel template: l'anteprima si aggiorna da sola e avvisa dell'entità che non esiste.
  await lineOf(4).click();
  await page.keyboard.press('End');
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('_x');
  await expect(panel.locator('.ok pre')).toHaveText('unknown');
  await expect(panel.locator('.missing')).toContainText('light.cucina_x');

  // Errore di sintassi: la riga la trova EDITHA ({% if %} alla riga 10 del file).
  await lineOf(9).click();
  await page.keyboard.press('Alt+t');
  await expect(panel.locator('.syntax')).toBeVisible();
  await panel.locator('button[data-action="template-goto"]').click();
  await expect(page.locator('editha-status-bar')).toContainText('Riga 10');

  // Basta un clic su un altro template: l'anteprima lo segue da sola.
  await lineOf(11).click();
  await expect(panel.locator('.render pre')).toHaveText('ZeroDivisionError: division by zero');
  await expect(panel.locator('.source')).toHaveText('auto.yaml, riga 11');
  // Su una riga senza template resta il risultato di prima.
  await lineOf(1).click();
  await page.waitForTimeout(900);
  await expect(panel.locator('.render pre')).toHaveText('ZeroDivisionError: division by zero');
  // Una selezione (per esempio per copiare) non parte da sola: solo con Alt+T.
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(900);
  await expect(panel.locator('.render pre')).toHaveText('ZeroDivisionError: division by zero');
});

test('GIT-1…6 – pannello Git: inizializza, modifiche, commit dei file scelti, differenze, storia, ripristino', async ({ page }) => {
  await page.locator('editha-file-tree button[data-action="git"]').click();
  const panel = page.locator('editha-git-panel');
  await expect(panel).toContainText('non c\'è ancora un repository Git');
  await expect(panel).toContainText('secrets.yaml');
  await panel.locator('button[data-action="git-init"]').click();
  await expect(page.locator('editha-toasts')).toContainText('Repository Git creato');
  await expect(panel).toContainText('main');
  await expect(panel).toContainText('Nessun commit ancora');
  expect(await disk('.gitignore')).toContain('*[Ss][Ee][Cc][Rr][Ee][Tt][Ss]*.[Yy]*[Mm][Ll]*');

  // GIT-2 e GIT-4: elenco delle modifiche, scelta di un solo file, commit.
  await expect(panel.locator('.changes-head')).toContainText('Modifiche');
  await expect(panel.locator('ul.changes')).toContainText('configuration.yaml');
  await expect(panel.locator('.hint')).toContainText('primo commit');
  // Una cartella nuova è una riga sola, con il numero di file; con il cerchio barrato si esclude.
  const tabsRow = panel.locator('ul.changes li', { hasText: 'tabs/' }).first();
  await expect(tabsRow).toContainText('3 file');
  await tabsRow.locator('button[data-action="git-ignore"]').click();
  await expect(page.locator('editha-toasts')).toContainText('Escluso dal repository: tabs/');
  await expect(panel.locator('ul.changes')).not.toContainText('tabs/');
  expect(await disk('.gitignore')).toContain('\n/tabs/\n');
  // Prima del primo commit niente confronto (non c'è niente con cui confrontare).
  await expect(panel.locator('button[data-action="git-diff"]')).toHaveCount(0);
  // Esclusi: l'elenco delle esclusioni, con «Includi» per annullarle.
  await panel.locator('button[data-action="git-ignored"]').click();
  await expect(panel.locator('ul.ignored')).toContainText('tabs/');
  await panel.locator('ul.ignored li', { hasText: 'tabs/' }).locator('button[data-action="git-unignore"]').click();
  await expect(page.locator('editha-toasts')).toContainText('Di nuovo nel repository: tabs/');
  await expect(panel.locator('ul.changes').first()).toContainText('tabs/');
  expect(await disk('.gitignore')).not.toContain('/tabs/');
  // Una cartella si apre: i suoi file uno per uno, ognuno con la sua spunta.
  const tabsAgain = panel.locator('ul.changes li', { hasText: 'tabs/' }).first();
  await tabsAgain.locator('button[data-action="git-folder"]').click();
  const inner = panel.locator('ul.changes li.inner');
  await expect(inner).toHaveCount(3);
  await inner.nth(0).locator('input[type="checkbox"]').uncheck();
  await expect(tabsAgain).toContainText('2 di 3 file');
  expect(await tabsAgain.locator('input[type="checkbox"]').evaluate((el: HTMLInputElement) => el.indeterminate)).toBe(true);
  // La spunta della cartella le rimette tutte.
  await tabsAgain.locator('input[type="checkbox"]').check();
  await expect(tabsAgain).toContainText('3 file');
  await expect(inner.nth(0).locator('input[type="checkbox"]')).toBeChecked();
  // secrets.yaml è escluso dal .gitignore: non compare nemmeno.
  await expect(panel.locator('ul.changes')).not.toContainText('secrets.yaml');
  await panel.locator('.changes-head input[type="checkbox"]').uncheck();
  await expect(inner.nth(0).locator('input[type="checkbox"]')).not.toBeChecked();
  // Dalla cartella senza spunta: un file solo.
  const onlyTab = (await inner.nth(1).locator('input[type="checkbox"]').getAttribute('data-path'))!;
  await inner.nth(1).locator('input[type="checkbox"]').check();
  await expect(tabsAgain).toContainText('1 di 3 file');
  await expect(panel.locator('button[data-action="git-commit"]')).toBeDisabled();
  await panel.locator('ul.changes input[data-path="configuration.yaml"]').check();
  await panel.locator('textarea.message').fill('Prima fotografia');
  await expect(panel.locator('button[data-action="git-commit"]')).toHaveText(/Commit \(2 file\)/);
  await panel.locator('textarea.message').press('Control+Enter');
  await expect(page.locator('editha-toasts')).toContainText('Commit creato: «Prima fotografia» (2 file)');
  await expect(panel.locator('.card')).toContainText('Prima fotografia');
  await expect(panel.locator('ul.changes')).not.toContainText('configuration.yaml');
  const git = (...args: string[]) => execFileSync('git', ['-C', configDir, ...args], { encoding: 'utf8' }).trim();
  expect(git('show', '--name-only', '--format=', 'HEAD')).toBe(['configuration.yaml', onlyTab].sort().join('\n'));

  // Un file salvato mentre il pannello è aperto ricompare tra le modifiche.
  await panel.locator('ul.changes button.path', { hasText: 'automations.yaml' }).click();
  await expect(activeTab(page)).toHaveAttribute('data-path', 'automations.yaml');
  await page.locator('editha-git-panel button[aria-label="Chiudi"]').click();
  await openFile(page, 'configuration.yaml');
  await editor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('# git\n');
  await page.keyboard.press('Control+s');
  await expect(activeTab(page)).not.toHaveClass(/dirty/);
  await page.locator('editha-file-tree button[data-action="git"]').click();
  await expect(panel.locator('ul.changes')).toContainText('configuration.yaml');

  // GIT-3: differenze rispetto all'ultimo commit, nella vista di confronto.
  await panel.locator('ul.changes li', { hasText: 'configuration.yaml' }).locator('button[data-action="git-diff"]').click();
  const compare = page.locator('editha-compare-panel');
  await expect(compare.locator('.labels')).toContainText('configuration.yaml (ultimo commit)');
  await expect(compare.locator('.labels')).toContainText('configuration.yaml (attuale)');
  await expect(compare).toContainText('# git');
  await compare.locator('button[title="Chiudi"]').click();
  // Il pannello Git è rimasto aperto.
  await expect(panel.locator('ul.changes')).toContainText('configuration.yaml');

  // GIT-5: storia dei commit, file toccati; GIT-6: confronto con quella versione e ripristino.
  const before = await disk('configuration.yaml');
  await panel.locator('button[data-action="git-log"]').click();
  const first = panel.locator('ul.log > li', { hasText: 'Prima fotografia' });
  await first.locator('button.commit-row').click();
  await expect(first.locator('ul.files')).toContainText('configuration.yaml');
  await first.locator('ul.files li', { hasText: 'configuration.yaml' }).locator('button[data-action="git-rev-diff"]').click();
  await expect(compare.locator('.labels')).toContainText(/configuration\.yaml \(commit [0-9a-f]{7}\)/);
  await compare.locator('button[title="Chiudi"]').click();
  await first.locator('ul.files li', { hasText: 'configuration.yaml' }).locator('button[data-action="git-restore"]').click();
  await expect(page.locator('editha-dialog dialog[open]')).toContainText('Prima fotografia');
  await dialogButton(page, 'Ripristina').click();
  await expect(page.locator('editha-toasts')).toContainText('ripristinato');
  expect(before).toContain('# git');
  expect(await disk('configuration.yaml')).toBe(before.replace('# git\n', ''));
  // La tab aperta mostra il contenuto ripristinato.
  await expect(editor(page)).not.toContainText('# git');

  // Chiuso il pannello torna l'albero, con il .gitignore nuovo.
  await panel.locator('button[aria-label="Chiudi"]').click();
  await expect(row(page, '.gitignore')).toBeVisible();
});

test('il pulsante Cronologia della barra apre e, al secondo clic, chiude la cronologia', async ({ page }) => {
  await openFile(page, 'tabs/a.yaml');
  const button = page.locator('editha-toolbar button[aria-label="Cronologia del file"]');
  await button.click();
  await expect(page.locator('editha-history-panel')).toBeVisible();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await button.click();
  await expect(page.locator('editha-history-panel')).toHaveCount(0);
  await expect(button).toHaveAttribute('aria-pressed', 'false');
});

test('SEC-7 – scaricando una cartella come ZIP, secrets.yaml resta fuori e lo si dice', async ({ page }) => {
  await row(page, 'links').click({ button: 'right' });
  const download = page.waitForEvent('download');
  await menuItem(page, 'Scarica come zip').click();
  await (await download).cancel();
  await expect(page.locator('editha-toasts')).toContainText('Lo ZIP non contiene links/secrets.yaml');
});

// In fondo: tocca la cronologia, che altri test usano.
test('BK-7 – elimina le versioni più vecchie: anteprima, conferma, spazio liberato', async ({ page, request }) => {
  // spazio/pulisci.yaml ha una versione di due anni fa (serve.mjs); ne aggiungiamo una di oggi.
  await openFile(page, 'spazio/pulisci.yaml');
  await editor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('b: 2\n');
  await page.keyboard.press('Control+s');
  await expect(activeTab(page)).not.toHaveClass(/dirty/);
  const versions = async () =>
    (await (await request.get('api/versions?path=spazio%2Fpulisci.yaml')).json()).versions.length;
  expect(await versions()).toBe(2);

  await openSpaceDialog(page);
  const space = page.locator('editha-history-space dialog[open]');
  await space.locator('select').selectOption('365');
  await space.locator('button[data-action="clean-preview"]').click();
  await expect(space).toContainText('Verrà eliminata 1 versione di 1 file o cartella');
  // L'anteprima non cancella niente.
  expect(await versions()).toBe(2);

  await space.locator('button[data-action="clean-delete"]').click();
  await expect(space).toContainText('non si potranno più ripristinare');
  await space.locator('button[data-action="clean-confirm"]').click();
  await expect(space.locator('[role="status"]')).toContainText('Fatto: eliminata 1 versione');
  // Resta solo la versione di oggi; il file in /config non è stato toccato.
  expect(await versions()).toBe(1);
  expect(await disk('spazio/pulisci.yaml')).toBe('a: 1\nb: 2\n');

  // Una data futura non si può usare: il pulsante Anteprima resta disattivato.
  await space.locator('select').selectOption('date');
  const tomorrow = new Date(Date.now() + 86_400_000);
  const ymd = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  await space.locator('input[type="date"]').fill(ymd);
  await expect(space.locator('button[data-action="clean-preview"]')).toBeDisabled();
});

// Ultimo di tutti: cancella l'intera cronologia.
test('BK-7 – cancella tutta la cronologia solo dopo aver scritto CANCELLA', async ({ page, request }) => {
  const usage = async () => (await (await request.get('api/history/usage')).json()) as { versions: number };
  expect((await usage()).versions).toBeGreaterThan(0);
  const before = await disk('spazio/pulisci.yaml');

  await openSpaceDialog(page);
  const space = page.locator('editha-history-space dialog[open]');
  await space.locator('select').selectOption('all');
  await space.locator('button[data-action="clean-preview"]').click();
  await space.locator('button[data-action="clean-delete"]', { hasText: 'Cancella tutta la cronologia' }).click();
  await expect(space).toContainText('irreversibile');
  const word = space.locator('#clean-word');
  await expect(word).toBeFocused();
  const confirm = space.locator('button[data-action="clean-confirm"]');
  await expect(confirm).toBeDisabled();
  await word.fill('cancella');
  await expect(confirm).toBeDisabled();
  expect((await usage()).versions).toBeGreaterThan(0);
  await word.fill('CANCELLA');
  await expect(confirm).toBeEnabled();
  // Invio conferma solo con la parola giusta.
  await word.press('Enter');
  await expect(space.locator('[role="status"]')).toContainText('Fatto:');
  expect((await usage()).versions).toBe(0);
  await expect(space).toContainText('La cronologia è vuota');
  // I file in /config restano come erano.
  expect(await disk('spazio/pulisci.yaml')).toBe(before);
});
