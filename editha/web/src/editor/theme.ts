import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/**
 * Tutti i colori arrivano dalle variabili CSS di index.html: cambiando tema
 * cambia solo l'attributo data-theme, l'editor non va ricreato.
 */
export const edithaTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--text)',
    backgroundColor: 'var(--editor-bg)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-code)',
    lineHeight: '1.6',
  },
  '.cm-content': {
    caretColor: 'var(--editor-cursor)',
    padding: '8px 0 40vh 4px',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--editor-cursor)', borderLeftWidth: '2px' },
  // Solo lo sfondo cambia: il testo selezionato resta leggibile (FEP #7).
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--editor-selection) !important' },
  '.cm-selectionMatch': { backgroundColor: 'var(--editor-selection-match)' },
  '.cm-activeLine': { backgroundColor: 'var(--editor-active-line)' },
  '.cm-gutters': {
    backgroundColor: 'var(--editor-gutter)',
    color: 'var(--editor-gutter-text)',
    border: 'none',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'var(--editor-active-line)', color: 'var(--text-muted)' },
  // Numeri piccoli e colonna stretta, vicina al codice.
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 4px 0 8px', minWidth: '0', fontSize: '0.82em' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 2px 0 0', cursor: 'pointer' },
  '.cm-fold-marker': { display: 'inline-block', width: '10px', textAlign: 'center', color: 'var(--text-faint)' },
  '.cm-fold-open': { opacity: '0', transition: 'opacity 0.15s' },
  '.cm-gutters:hover .cm-fold-open': { opacity: '1' },
  '.cm-fold-closed': { color: 'var(--accent)', fontWeight: '700' },
  '.cm-fold-marker:hover': { color: 'var(--accent)' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--accent-soft)',
    border: 'none',
    color: 'var(--accent)',
    borderRadius: '4px',
    padding: '0 6px',
  },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--accent)' },
  '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'var(--danger-soft)' },
  '.cm-searchMatch': { backgroundColor: 'rgba(255, 196, 0, 0.3)', outline: '1px solid rgba(255, 170, 0, 0.6)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(255, 150, 0, 0.45)' },
  '.cm-panels': { backgroundColor: 'var(--surface-2)', color: 'var(--text)' },
  '.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-panel.cm-search': { padding: '8px 12px', fontFamily: 'var(--font-ui)', fontSize: '13px' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': { fontSize: '13px' },
  '.cm-panel.cm-search input[type=text], .cm-textfield': {
    background: 'var(--surface)',
    color: 'var(--text)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-sm)',
    padding: '4px 8px',
    outline: 'none',
  },
  '.cm-textfield:focus': { borderColor: 'var(--accent)', boxShadow: '0 0 0 3px var(--accent-soft)' },
  '.cm-button': {
    backgroundImage: 'none',
    background: 'var(--surface)',
    color: 'var(--text)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-sm)',
    padding: '4px 10px',
  },
  '.cm-button:hover': { background: 'var(--hover)' },
  '.cm-panel.cm-search [name=close]': { color: 'var(--text-muted)', fontSize: '18px', right: '8px' },
  '.cm-tooltip': {
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    boxShadow: 'var(--shadow-pop)',
    overflow: 'hidden',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent-soft)', color: 'var(--text)' },
  '.cm-tooltip-lint': { padding: '0' },
  // I messaggi lunghi (entità sconosciuta con la correzione) vanno a capo invece di coprire i pannelli.
  '.cm-tooltip-hover': { maxWidth: 'min(560px, 90vw)', overflowWrap: 'anywhere' },
  '.cm-diagnostic': { padding: '6px 10px', borderLeftWidth: '4px', fontFamily: 'var(--font-ui)' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--danger)' },
  '.cm-diagnostic-warning': { borderLeftColor: 'var(--warning)' },
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--danger)',
    textUnderlineOffset: '3px',
  },
  '.cm-lintRange-warning': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--warning)',
    textUnderlineOffset: '3px',
  },
  // Pannello "Problemi" (Ctrl+Maiusc+M o clic sul conteggio nella barra di stato).
  '.cm-panel.cm-panel-lint': {
    backgroundColor: 'var(--surface)',
    borderTop: '1px solid var(--border)',
    fontFamily: 'var(--font-ui)',
  },
  '.cm-panel.cm-panel-lint ul': { maxHeight: '35vh', outline: 'none' },
  // Voce selezionata: lo stesso colore tenue della selezione nell'albero, non il blu di sistema.
  '.cm-panel.cm-panel-lint ul [aria-selected], .cm-panel.cm-panel-lint ul:focus [aria-selected]': {
    backgroundColor: 'var(--accent-soft) !important',
    color: 'var(--text) !important',
  },
  '.cm-panel.cm-panel-lint ul:focus [aria-selected] .cm-diagnosticSource': { color: 'var(--text-muted)' },
  '.cm-panel.cm-panel-lint li': { cursor: 'pointer' },
  '.cm-panel.cm-panel-lint li:hover': { backgroundColor: 'var(--hover)' },
  '.cm-panel.cm-panel-lint [name=close]': {
    top: '6px',
    background: 'transparent',
    border: 'none',
    right: '10px',
    color: 'var(--text-muted)',
    fontSize: '18px',
    cursor: 'pointer',
  },
  '.cm-diagnosticSource': { color: 'var(--text-muted)', fontSize: '12px', opacity: '1' },
  // HA-5: bersagli di !include e !secret, apribili con Ctrl+clic.
  '.cm-mdi-preview': { display: 'inline-flex', verticalAlign: 'middle', marginRight: '8px', color: 'var(--accent)' },
  '.cm-completionIcon-mdi': { display: 'none' },
  '.cm-ha-link': { textDecoration: 'underline dotted', textUnderlineOffset: '3px' },
  '.cm-ha-link:hover': { textDecorationStyle: 'solid' },
  '.cm-gutter-lint': { width: '14px' },
  '.cm-lint-marker': { width: '10px', height: '10px', margin: '4px 2px' },
});

const highlight = HighlightStyle.define([
  { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--syn-key)' },
  { tag: [t.string, t.special(t.string), t.inserted], color: 'var(--syn-string)' },
  { tag: [t.number, t.integer, t.float], color: 'var(--syn-number)' },
  { tag: [t.bool, t.null, t.atom], color: 'var(--syn-atom)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.typeName, t.tagName, t.labelName, t.annotation, t.meta], color: 'var(--syn-tag)' },
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.className], color: 'var(--syn-function)' },
  { tag: [t.punctuation, t.separator, t.bracket, t.operator], color: 'var(--syn-punct)' },
  { tag: t.heading, color: 'var(--syn-heading)', fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.link, color: 'var(--accent)', textDecoration: 'underline' },
  { tag: t.invalid, color: 'var(--danger)' },
]);

export const edithaHighlighting = syntaxHighlighting(highlight);

/**
 * Dimensione del carattere: 0 (automatica) segue --editor-font-size (13 px su PC, 14 px su
 * telefono); un valore scelto dall'utente vale ovunque.
 */
export function fontSizeTheme(size: number) {
  return EditorView.theme({ '&': { fontSize: size > 0 ? `${size}px` : 'var(--editor-font-size)' } });
}
