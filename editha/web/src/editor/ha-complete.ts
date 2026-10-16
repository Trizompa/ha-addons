import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { haData } from '../state/ha-data.js';
import { secretKeys } from '../state/secrets.js';
import { mdiIcons } from '../state/mdi.js';
import { filePath } from './links.js';
import { t } from '../i18n/index.js';

const SERVICE_KEY = /\b(service|action)\s*:\s*["']?[\w.]*$/;
const ENTITY_KEY = /\b(entity_id|entities|entity)\s*:\s*["']?[\w.]*$/;

function entityOptions(): Completion[] {
  return haData.entities.map((e) => ({
    label: e.entity_id,
    detail: e.unit ? `${e.state} ${e.unit}` : e.state,
    info: e.name || undefined,
    type: 'variable',
  }));
}

function serviceOptions(): Completion[] {
  return haData.services.map((s) => ({
    label: s.id,
    detail: s.name || undefined,
    info: s.description || undefined,
    type: 'function',
  }));
}

/**
 * Autocompletamento di entità e azioni del proprio HA (HA-2, HA-3): si attiva scrivendo
 * "dominio." (es. "light."), dopo "entity_id:" / "action:", oppure con Ctrl+Spazio.
 */
export function haCompletions(ctx: CompletionContext): CompletionResult | null {
  if (!haData.available) return null;
  const word = ctx.matchBefore(/[a-z_][a-z0-9_]*(\.[a-z0-9_]*)?/);
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = line.text.slice(0, ctx.pos - line.from);
  if (/^\s*#/.test(before)) return null;
  const isService = SERVICE_KEY.test(before);
  const isEntity = ENTITY_KEY.test(before);
  const dotted = !!word?.text.includes('.');
  if (!ctx.explicit && !dotted && !isService && !isEntity) return null;
  if (!ctx.explicit && !word && !isService && !isEntity) return null;
  const from = word ? word.from : ctx.pos;
  let options: Completion[];
  if (isService) {
    options = serviceOptions();
  } else if (dotted) {
    // "light." può essere sia un'entità sia un'azione: le entità vengono prima.
    options = [...entityOptions(), ...serviceOptions().map((o) => ({ ...o, boost: -1 }))];
  } else {
    options = entityOptions();
  }
  return { from, options, validFor: /^[a-z0-9_.]*$/ };
}

/** HA-4: dopo `!secret ` propone le chiavi dei secrets.yaml visibili dal file (solo i nomi). */
export async function secretCompletions(ctx: CompletionContext): Promise<CompletionResult | null> {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = line.text.slice(0, ctx.pos - line.from);
  const m = /!secret[ \t]+([\w.-]*)$/.exec(before);
  if (!m) return null;
  const keys = await secretKeys(ctx.state.facet(filePath));
  if (keys.length === 0) return null;
  return {
    from: ctx.pos - m[1]!.length,
    options: keys.map((k) => ({
      label: k.key,
      type: 'variable',
      detail: k.path === 'secrets.yaml' ? t('link.secret') : k.path,
    })),
    validFor: /^[\w.-]*$/,
  };
}

/** Suggerimento di un'icona: porta con sé il disegno per l'anteprima nell'elenco. */
export interface MdiCompletion extends Completion {
  mdiPath: string;
}

/** Icone Material Design: dopo "mdi:" propone i nomi, con l'anteprima di ciascuna. */
export async function mdiCompletions(ctx: CompletionContext): Promise<CompletionResult | null> {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = line.text.slice(0, ctx.pos - line.from);
  const m = /(?:^|[^\w-])mdi:([a-z0-9-]*)$/.exec(before);
  if (!m) return null;
  const icons = await mdiIcons();
  if (icons.size === 0) return null;
  const options: MdiCompletion[] = [];
  for (const [name, path] of icons) options.push({ label: name, type: 'mdi', mdiPath: path });
  return { from: ctx.pos - m[1]!.length, options, validFor: /^[a-z0-9-]*$/ };
}
