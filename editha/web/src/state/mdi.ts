import { VERSION } from '../version.js';

let icons: Promise<Map<string, string>> | null = null;

/**
 * Icone Material Design (nome → disegno SVG), generate in fase di build. Il file è grande
 * (~600 KB compresso): si scarica solo la prima volta che si scrive "mdi:".
 */
export function mdiIcons(): Promise<Map<string, string>> {
  if (!icons) {
    icons = fetch(`mdi-icons.json?v=${encodeURIComponent(VERSION)}`)
      .then((r) => {
        // Errore HTTP (502 durante un riavvio): niente elenco vuoto in memoria, si riprova.
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Record<string, string>>;
      })
      .then((data) => new Map<string, string>(Object.entries(data)))
      .catch(() => {
        // Riprova la prossima volta (rete assente, add-on in riavvio).
        icons = null;
        return new Map<string, string>();
      });
  }
  return icons;
}

/** Piccola anteprima dell'icona, per l'elenco dei suggerimenti. */
export function mdiSvg(path: string, size = 18): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', path);
  p.setAttribute('fill', 'currentColor');
  svg.appendChild(p);
  return svg;
}
