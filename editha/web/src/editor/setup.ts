import { Compartment, EditorState, type Extension } from '@codemirror/state';
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
import { lintYaml } from './yaml-lint.js';
import { wrapIndent } from './wrap-indent.js';
import { haCompletions, mdiCompletions, secretCompletions, type MdiCompletion } from './ha-complete.js';
import { mdiSvg } from '../state/mdi.js';
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

const yamlLinter = linter(
  (view) =>
    lintYaml(view.state.doc.toString()).map((p) => ({
      from: p.from,
      to: p.to,
      severity: p.severity,
      message: p.message,
      // Nell'elenco dei problemi ogni voce dice a che riga si trova.
      source: t('status.lineN', { n: view.state.doc.lineAt(p.from).number }),
    })),
  { delay: 300 },
);

function languageExtensions(path: string): { language: Extension; lint: Extension } {
  const id: LanguageId = languageOf(path).id;
  return {
    language: [languageSupport(id), filePath.of(path)],
    // Niente colonna dei marcatori: gli errori sono sottolineati e contati nella barra di stato.
    lint:
      id === 'yaml'
        ? [
            yamlLinter,
            haLinks,
            EditorState.languageData.of(() => [{ autocomplete: haCompletions }, { autocomplete: secretCompletions }, { autocomplete: mdiCompletions }]),
          ]
        : [],
  };
}

const baseExtensions: Extension = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
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

/** Effetti per aggiornare uno stato esistente (tab attiva o in secondo piano). */
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
    highlightSpecialChars(),
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
