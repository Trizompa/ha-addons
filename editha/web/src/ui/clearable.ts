import { html, nothing, type TemplateResult } from 'lit';
import { t } from '../i18n/index.js';
import { icon, icons } from './icons.js';

/**
 * Campo di ricerca o filtro con la × per svuotarlo (compare solo se c'è del testo). Il focus
 * resta nel campo, così si può scrivere subito altro. Stili in sharedStyles (.clearable).
 */
export function clearable(input: TemplateResult, value: string, onClear: () => void): TemplateResult {
  return html`<span class="clearable">
    ${input}
    ${value
      ? html`<button
          type="button"
          class="clear-btn"
          title=${t('common.clear')}
          aria-label=${t('common.clear')}
          @mousedown=${(e: Event) => e.preventDefault()}
          @click=${(e: Event) => {
            onClear();
            ((e.currentTarget as HTMLElement).parentElement?.querySelector('input') as HTMLInputElement | null)?.focus();
          }}
        >
          ${icon(icons.close, 15)}
        </button>`
      : nothing}
  </span>`;
}
