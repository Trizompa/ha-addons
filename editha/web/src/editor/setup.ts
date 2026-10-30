import { Compartment, EditorState, StateEffect, type Extension } from '@codemirror/state';
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { linter, lintKeymap } from '@codemirror/lint';
import { indentationMarkers } from '@replit/codemirror-indentation-markers';
import { languageOf, languageSupport, type LanguageId } from './languages.js';
import { edithaHighlighting, edithaTheme, fontSizeTheme } from './theme.js';
import { lintYaml, suggestionsPending } from './yaml-lint.js';
import { wrapIndent } from './wrap-indent.js';
import { haCompletions, haDetailCompletions, mdiCompletions, secretCompletions, type MdiCompletion } from './ha-complete.js';
import { mdiSvg } from '../state/mdi.js';
import { haData } from '../state/ha-data.js';
import { filePath, haLinks } from './links.js';
import { hideKeyboardButton } from './keyboard.js';
import { dictionary, getLang, t } from '../i18n/index.js';

/** Frasi dell'interfaccia di CodeMirror (ricerca, piegatura, problemi) nella lingua corrente. */
export function phrasesExtension(): Extension {
  if (getLang() === 'en') return [];
  const dict = dictionary(getLang()) as Record<string, string>;
  const phrases: Record<string, string> = {};
  for (const [key, value] of Object.entries(dict)) if (key.startsWith('cm.')) phrases[key.slice(3)] = value;
  return EditorState.phrases.of(phrases);
}

export interface EditorPrefs {
  wordWrap: boolean;
  /** Pixel del carattere; 0 = automatica (segue il dispositivo). */
  fontSize: number;
}

/** Parti che cambiano senza ricreare lo stato (impostazioni, linguaggio dopo una rinomina). */
export const compartments = {
  phrases: new Compartment(),
  language: new Compartment(),
  lint: new Compartment(),
  wrap: new Compartment(),
  fontSize: new Compartment(),
  readOnly: new Compartment(),
};

/**
 * Controllo YAML del file `path`. Ogni chiamata crea un'istanza nuova: riconfigurare il
 * compartimento `lint` con una nuova istanza fa ripartire il controllo (cambio di lingua).
 */
function yamlLinter(path: string): Extension {
  return linter(
    // Il testo con «\n» (anche per i file CRLF): le posizioni coincidono con quelle del documento.
    (view) => {
      const problems = lintYaml(view.state.doc.toString(), path, haData.entityIds());
      // Suggestioni non ancora calcolate (tante entità sconosciute): un altro giro subito dopo.
      if (suggestionsPending) setTimeout(() => view.dom.isConnected && view.dispatch({ effects: relint.of(null) }), 50);
      return problems.map((p) => ({
        from: p.from,
        to: p.to,
        severity: p.severity,
        message: p.message,
        // Nell'elenco dei problemi ogni voce dice a che riga si trova.
        source: t('status.lineN', { n: view.state.doc.lineAt(p.from).number }),
        ...(p.fix !== undefined ? { actions: [replaceAction(p.fix)] } : {}),
      }));
    },
    // forceLinting non basta: non fa niente se non c'è già un controllo in attesa.
    { delay: 300, needsRefresh: (update) => update.transactions.some((tr) => tr.effects.some((e) => e.is(relint))) },
  );
}

/** Fa ripartire il controllo senza cambiare il testo (entità arrivate, suggerimenti da completare). */
const relint = StateEffect.define<null>();

/** Pulsante nel suggerimento dell'errore: mette `text` al posto della parte sottolineata. */
function replaceAction(text: string) {
  return {
    name: t('yaml.fix.replace', { text }),
    apply: (view: EditorView, from: number, to: number) => view.dispatch({ changes: { from, to, insert: text } }),
  };
}

/** Quando arrivano o cambiano le entità di Home Assistant il controllo riparte (entità sconosciute). */
const relintOnHaData = ViewPlugin.fromClass(
  class {
    private readonly unsubscribe: () => void;
    private ids: ReadonlySet<string>;
    constructor(view: EditorView) {
      this.ids = haData.entityIds();
      this.unsubscribe = haData.subscribe(() => {
        const ids = haData.entityIds();
        if (ids === this.ids) return;
        this.ids = ids;
        view.dispatch({ effects: relint.of(null) });
      });
    }
    destroy(): void {
      this.unsubscribe();
    }
  },
);

/** Testo del documento con i suoi fine riga (CRLF se il file li aveva): è quello da salvare. */
export function docText(state: EditorState): string {
  return state.sliceDoc();
}

/**
 * Con il separatore CRLF un «\n» da solo (testo incollato da Linux o Mac) resterebbe dentro la
 * riga: lo si trasforma in un vero a capo. La lunghezza non cambia, quindi la selezione resta giusta.
 */
const crlfInput = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  const fixes: { from: number; to: number; insert: string }[] = [];
  tr.changes.iterChanges((_fromA, _toA, fromB, toB, inserted) => {
    for (const line of inserted.iterLines()) {
      if (!line.includes('\n')) continue;
      fixes.push({ from: fromB, to: toB, insert: tr.newDoc.sliceString(fromB, toB, '\r\n').replace(/\r?\n/g, '\r\n') });
      break;
    }
  });
  return fixes.length ? [tr, { changes: fixes, sequential: true }] : tr;
});

/**
 * Separatore di riga del file: CRLF se tutte le righe finiscono così, e il file si salva com'era.
 * Un file misto (CRLF e LF insieme) si mostra a righe normali e si salva con LF: con il solo
 * separatore CRLF le righe LF apparirebbero incollate.
 */
function lineSeparatorFor(doc: string): Extension {
  return doc.includes('\r\n') && !/(^|[^\r])\n/.test(doc) ? [EditorState.lineSeparator.of('\r\n'), crlfInput] : [];
}

/** Spazi speciali (U+00A0, U+2000–U+200A, U+3000) resi visibili: in YAML rompono il rientro. */
const visibleSpecialChars = highlightSpecialChars({ addSpecialChars: /[\u00a0\u2000-\u200a\u3000]/ });

function languageExtensions(path: string): { language: Extension; lint: Extension } {
  const id: LanguageId = languageOf(path).id;
  return {
    language: [languageSupport(id), filePath.of(path)],
    // Niente colonna dei marcatori: gli errori sono sottolineati e contati nella barra di stato.
    lint:
      id === 'yaml'
        ? [
            yamlLinter(path),
            relintOnHaData,
            haLinks,
            EditorState.languageData.of(() => [{ autocomplete: haCompletions }, { autocomplete: haDetailCompletions }, { autocomplete: secretCompletions }, { autocomplete: mdiCompletions }]),
          ]
        : [],
  };
}

const baseExtensions: Extension = [
  lineNumbers(),
  highlightActiveLineGutter(),
  visibleSpecialChars,
  history(),
  // Le frecce di piegatura compaiono passando sul margine; quelle dei blocchi piegati restano visibili.
  foldGutter({
    markerDOM: (open) => {
      const el = document.createElement('span');
      el.className = open ? 'cm-fold-marker cm-fold-open' : 'cm-fold-marker cm-fold-closed';
      el.textContent = open ? '⌄' : '›';
      el.title = open ? t('fold.fold') : t('fold.unfold');
      return el;
    },
  }),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  edithaHighlighting,
  bracketMatching(),
  closeBrackets(),
  autocompletion({
    // Le icone MDI si vedono già nell'elenco, prima del nome.
    addToOptions: [
      {
        render: (completion) => {
          const path = (completion as Partial<MdiCompletion>).mdiPath;
          if (!path) return null;
          const span = document.createElement('span');
          span.className = 'cm-mdi-preview';
          span.appendChild(mdiSvg(path));
          return span;
        },
        position: 20,
      },
    ],
  }),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  search({ top: true }),
  // Tab e Shift-Tab indentano anche una selezione su più righe (ED-1, FEP #8);
  // l'operazione finisce nella cronologia, quindi Annulla la toglie (FEP #14).
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...completionKeymap,
    ...lintKeymap,
    indentWithTab,
  ]),
  indentUnit.of('  '),
  EditorState.tabSize.of(2),
  indentationMarkers({
    highlightActiveBlock: true,
    markerType: 'codeOnly',
    colors: {
      light: 'var(--editor-indent-guide)',
      dark: 'var(--editor-indent-guide)',
      activeLight: 'var(--editor-indent-guide-active)',
      activeDark: 'var(--editor-indent-guide-active)',
    },
  }),
  // Niente controllo ortografico, correzione o traduzione del browser (ED-16, FEP #5).
  EditorView.contentAttributes.of({
    spellcheck: 'false',
    autocorrect: 'off',
    autocapitalize: 'off',
    translate: 'no',
  }),
  edithaTheme,
  hideKeyboardButton,
];

export interface StateOptions {
  doc: string;
  path: string;
  readOnly: boolean;
  prefs: EditorPrefs;
  selection?: { anchor: number; head: number };
  onUpdate: (update: ViewUpdate) => void;
}

export function createEditorState(opts: StateOptions): EditorState {
  const lang = languageExtensions(opts.path);
  const len = opts.doc.length;
  const clamp = (n: number) => Math.max(0, Math.min(n, len));
  return EditorState.create({
    doc: opts.doc,
    ...(opts.selection
      ? { selection: { anchor: clamp(opts.selection.anchor), head: clamp(opts.selection.head) } }
      : {}),
    extensions: [
      // Fuori dai compartimenti: nessuna riconfigurazione lo toglie.
      lineSeparatorFor(opts.doc),
      baseExtensions,
      compartments.phrases.of(phrasesExtension()),
      compartments.language.of(lang.language),
      compartments.lint.of(lang.lint),
      compartments.wrap.of(opts.prefs.wordWrap ? [EditorView.lineWrapping, wrapIndent] : []),
      compartments.fontSize.of(fontSizeTheme(opts.prefs.fontSize)),
      compartments.readOnly.of(EditorState.readOnly.of(opts.readOnly)),
      EditorView.updateListener.of(opts.onUpdate),
    ],
  });
}

/**
 * Effetti per aggiornare uno stato esistente (tab attiva o in secondo piano). Con `path`
 * il controllo YAML riparte: dopo un cambio di lingua i messaggi si rifanno subito.
 */
export function reconfigureEffects(changes: {
  path?: string;
  prefs?: EditorPrefs;
  readOnly?: boolean;
  phrases?: boolean;
}) {
  const effects = [];
  if (changes.phrases) effects.push(compartments.phrases.reconfigure(phrasesExtension()));
  if (changes.path !== undefined) {
    const lang = languageExtensions(changes.path);
    effects.push(compartments.language.reconfigure(lang.language), compartments.lint.reconfigure(lang.lint));
  }
  if (changes.prefs) {
    effects.push(
      compartments.wrap.reconfigure(changes.prefs.wordWrap ? [EditorView.lineWrapping, wrapIndent] : []),
      compartments.fontSize.reconfigure(fontSizeTheme(changes.prefs.fontSize)),
    );
  }
  if (changes.readOnly !== undefined) {
    effects.push(compartments.readOnly.reconfigure(EditorState.readOnly.of(changes.readOnly)));
  }
  return effects;
}

/** Vista di sola lettura (confronto delle versioni): stesso aspetto dell'editor, nessuna modifica. */
export function viewerExtensions(path: string, prefs: EditorPrefs): Extension {
  return [
    lineNumbers(),
    visibleSpecialChars,
    edithaHighlighting,
    phrasesExtension(),
    languageSupport(languageOf(path).id),
    prefs.wordWrap ? [EditorView.lineWrapping, wrapIndent] : [],
    fontSizeTheme(prefs.fontSize),
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    EditorView.contentAttributes.of({ spellcheck: 'false', translate: 'no' }),
    edithaTheme,
  ];
}
