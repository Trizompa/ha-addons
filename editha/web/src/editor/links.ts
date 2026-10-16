import { Facet, RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { t } from '../i18n/index.js';

/** Percorso (relativo a /config) del file mostrato: serve a risolvere include e secret. */
export const filePath = Facet.define<string, string>({ combine: (values) => values[0] ?? '' });

export type LinkKind = 'include' | 'dir' | 'secret';

export interface EditorLink {
  kind: LinkKind;
  /** Percorso scritto dopo !include… o nome della chiave dopo !secret. */
  target: string;
  /** Posizione del bersaglio nella riga. */
  from: number;
  to: number;
}

const LINK = /!(include(?:_dir_(?:list|named|merge_list|merge_named))?|secret)[ \t]+("[^"\n]*"|'[^'\n]*'|[^\s#]+)/g;

/** Collegamenti (HA-5) presenti in una riga: `!include file`, `!include_dir_… cartella`, `!secret chiave`. */
export function linksIn(line: string): EditorLink[] {
  const links: EditorLink[] = [];
  // Niente collegamenti dentro i commenti.
  const comment = /(^|\s)#/.exec(line);
  const end = comment ? comment.index : line.length;
  for (const m of line.matchAll(LINK)) {
    if (m.index! >= end) break;
    const raw = m[2]!;
    const quoted = raw.startsWith('"') || raw.startsWith("'");
    const target = quoted ? raw.slice(1, -1) : raw;
    if (!target) continue;
    const from = m.index! + m[0].length - raw.length + (quoted ? 1 : 0);
    const kind: LinkKind = m[1] === 'secret' ? 'secret' : m[1] === 'include' ? 'include' : 'dir';
    links.push({ kind, target, from, to: from + target.length });
  }
  return links;
}

export function linkAt(line: string, column: number): EditorLink | null {
  return linksIn(line).find((l) => column >= l.from && column <= l.to) ?? null;
}

const linkMark = (kind: LinkKind) =>
  Decoration.mark({
    class: 'cm-ha-link',
    attributes: { title: kind === 'secret' ? t('link.hintSecret') : t('link.hint') },
  });

function buildLinks(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      for (const link of linksIn(line.text)) builder.add(line.from + link.from, line.from + link.to, linkMark(link.kind));
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

/**
 * HA-5: i bersagli di !include e !secret sono sottolineati; Ctrl+clic (Cmd+clic su Mac)
 * chiede all'app di aprirli con l'evento "editha-link".
 */
export const haLinks = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildLinks(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) this.decorations = buildLinks(update.view);
      }
    },
    { decorations: (v) => v.decorations },
  ),
  EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;
      const line = view.state.doc.lineAt(pos);
      const link = linkAt(line.text, pos - line.from);
      if (!link) return false;
      event.preventDefault();
      view.dom.dispatchEvent(
        new CustomEvent('editha-link', {
          bubbles: true,
          composed: true,
          detail: { kind: link.kind, target: link.target, file: view.state.facet(filePath) },
        }),
      );
      return true;
    },
  }),
];
