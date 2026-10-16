import type { Extension } from '@codemirror/state';
import { yaml } from '@codemirror/lang-yaml';
import { json } from '@codemirror/lang-json';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { jinja } from '@codemirror/lang-jinja';
import { basename, extension } from '../state/paths.js';

export type LanguageId = 'yaml' | 'json' | 'python' | 'javascript' | 'typescript' | 'css' | 'markdown' | 'jinja' | 'text';

export interface LanguageInfo {
  id: LanguageId;
  label: string;
}

const BY_EXTENSION: Record<string, LanguageId> = {
  yaml: 'yaml',
  yml: 'yaml',
  json: 'json',
  py: 'python',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  css: 'css',
  md: 'markdown',
  markdown: 'markdown',
  jinja: 'jinja',
  jinja2: 'jinja',
  j2: 'jinja',
};

const LABELS: Record<LanguageId, string> = {
  yaml: 'YAML',
  json: 'JSON',
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  css: 'CSS',
  markdown: 'Markdown',
  jinja: 'Jinja',
  text: 'Plain text',
};

/** Linguaggio di un file in base al nome (ED-2). */
export function languageOf(path: string): LanguageInfo {
  // Il nome del testo semplice dipende dalla lingua: lo traduce chi lo mostra (lang.text).
  const name = basename(path);
  // File di HA senza estensione o con nomi particolari.
  // Le copie di sicurezza (nome.yaml.bak) si leggono come l'originale.
  const plain = /\.bak$/i.test(name) ? name.slice(0, -4) : name;
  const id = name === '.HA_VERSION' ? 'text' : (BY_EXTENSION[extension(plain)] ?? 'text');
  return { id, label: LABELS[id] };
}

export function languageSupport(id: LanguageId): Extension {
  switch (id) {
    case 'yaml':
      return yaml();
    case 'json':
      return json();
    case 'python':
      return python();
    case 'javascript':
      return javascript();
    case 'typescript':
      return javascript({ typescript: true });
    case 'css':
      return css();
    case 'markdown':
      return markdown();
    case 'jinja':
      return jinja();
    case 'text':
      return [];
  }
}

