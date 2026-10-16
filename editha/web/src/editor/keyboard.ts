import { StateEffect, StateField } from '@codemirror/state';
import { EditorView, showTooltip, type Tooltip } from '@codemirror/view';
import { t } from '../i18n/index.js';

/**
 * Su iPhone la tastiera si chiude solo togliendo il focus all'editor, e quando si apre iOS
 * sposta la pagina: la barra in alto finisce fuori schermo. Il pulsante "chiudi la tastiera"
 * sta quindi accanto al cursore, l'unico punto che iOS tiene sempre visibile.
 */
const setFocus = StateEffect.define<boolean>();

const focused = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => {
    for (const e of tr.effects) if (e.is(setFocus)) return e.value;
    return value;
  },
});

const touch = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

function keyboardTooltip(head: number): Tooltip {
  return {
    pos: head,
    above: true,
    strictSide: false,
    arrow: false,
    create: (view) => {
      const dom = document.createElement('div');
      dom.className = 'cm-hide-keyboard';
      const button = document.createElement('button');
      button.type = 'button';
      button.title = t('toolbar.hideKeyboard');
      button.setAttribute('aria-label', t('toolbar.hideKeyboard'));
      // Icona "tastiera con freccia in giù" (Material Design: keyboard-close).
      button.innerHTML =
        '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12,23L16,19H8L12,23M19,8H17V6H19M19,11H17V9H19M16,8H14V6H16M16,11H14V9H16M16,15H8V13H16M7,8H5V6H7M7,11H5V9H7M8,9H10V11H8M8,6H10V8H8M11,9H13V11H11M11,6H13V8H11M20,3H4C2.89,3 2,3.89 2,5V15A2,2 0 0,0 4,17H20A2,2 0 0,0 22,15V5C22,3.89 21.1,3 20,3Z"/></svg>';
      // Il tocco non deve spostare il cursore né togliere il focus prima del clic.
      button.addEventListener('mousedown', (e) => e.preventDefault());
      button.addEventListener('click', () => view.contentDOM.blur());
      dom.appendChild(button);
      return { dom };
    },
  };
}

export const hideKeyboardButton = [
  focused,
  EditorView.focusChangeEffect.of((_state, focusing) => (touch() ? setFocus.of(focusing) : null)),
  showTooltip.compute(['selection', focused], (state) =>
    state.field(focused) ? keyboardTooltip(state.selection.main.head) : null,
  ),
  EditorView.theme({
    // A destra dell'editor, all'altezza del cursore: non copre il testo che si sta scrivendo.
    '.cm-tooltip.cm-hide-keyboard': {
      left: 'auto !important',
      right: '8px',
      border: 'none',
      background: 'transparent',
    },
    '.cm-hide-keyboard button': {
      display: 'grid',
      placeItems: 'center',
      width: '40px',
      height: '32px',
      border: '1px solid var(--border)',
      borderRadius: '10px',
      background: 'var(--accent-soft)',
      color: 'var(--accent)',
      boxShadow: 'var(--shadow-pop)',
    },
  }),
];
