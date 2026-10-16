import { detectLang, setLang } from './i18n/index.js';

// Lingua del browser già al primo disegno; le impostazioni salvate la correggono subito dopo.
setLang(detectLang());
document.documentElement.lang = detectLang();

await import('./components/app.js');
