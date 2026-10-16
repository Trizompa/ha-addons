import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';

/** Rientro aggiuntivo delle righe spezzate rispetto all'indentazione della riga. */
const HANG = 2;

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tabSize = view.state.tabSize;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      let cols = 0;
      for (const ch of line.text) {
        if (ch === ' ') cols++;
        else if (ch === '\t') cols += tabSize - (cols % tabSize);
        else break;
      }
      const indent = cols + HANG;
      builder.add(
        line.from,
        line.from,
        Decoration.line({ attributes: { style: `padding-left:calc(${indent}ch + 6px);text-indent:-${indent}ch` } }),
      );
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

/**
 * Con l'a capo automatico, il seguito di una riga lunga resta allineato
 * alla sua indentazione invece di ripartire dal margine sinistro.
 */
export const wrapIndent = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = build(update.view);
    }
  },
  { decorations: (v) => v.decorations },
);
