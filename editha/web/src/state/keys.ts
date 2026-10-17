/** Mac, iPhone e iPad (iPadOS si presenta come MacIntel): Cmd al posto di Ctrl, Opzione al posto di Alt. */
export const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

/**
 * Lettera di una scorciatoia (Ctrl+S, Alt+W…). Vale il carattere della tastiera dell'utente
 * quando è una lettera latina (AZERTY, Dvorak, e anche ś o ß scritte con AltGr, che così non
 * diventano una scorciatoia); per gli altri alfabeti e per Opzione su Mac, che scrive simboli,
 * si guarda il tasto fisico.
 */
export function shortcutKey(e: Pick<KeyboardEvent, 'key' | 'code' | 'altKey'>, mac = MAC): string {
  const key = e.key.length === 1 ? e.key.toLowerCase() : '';
  if (!(mac && e.altKey) && /^[\x21-\x7e]$|^\p{Script=Latin}$/u.test(key)) return key;
  return /^Key([A-Z])$/.exec(e.code)?.[1]?.toLowerCase() ?? '';
}

/** Etichette delle scorciatoie scritte per Windows e Linux, nella forma del Mac (⌘ ⌥ ⇧). */
export function shortcutLabel(text: string, mac = MAC): string {
  if (!mac) return text;
  return text
    .replace('Ctrl+Y', 'Ctrl+Shift+Z') // su Mac Ripeti è ⌘⇧Z
    .replace(/Ctrl\+/g, '⌘')
    .replace(/Alt\+/g, '⌥')
    .replace(/(Shift|Maiusc)\+/g, '⇧');
}
