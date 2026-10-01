import { selectLanguageServer } from '@emdash/core/runtimes/lsp/api';

/**
 * Utilities for detecting programming languages from file paths.
 */

/**
 * Detect programming language from file path extension.
 * Returns a language identifier compatible with Monaco Editor.
 */
export function getLanguageFromPath(path: string): string {
  const selected = selectLanguageServer(path);
  if (selected) return toMonacoLanguageId(selected.language.languageId);
  const ext = path.split(/[\\/]/).at(-1)?.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    java: 'java',
    cs: 'csharp',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    scala: 'scala',
    zsh: 'shell',
    fish: 'shell',
    xml: 'xml',
    sass: 'sass',
    sql: 'sql',
    md: 'markdown',
    markdown: 'markdown',
    vue: 'vue',
    svelte: 'svelte',
    dart: 'dart',
    lua: 'lua',
    perl: 'perl',
    r: 'r',
    matlab: 'matlab',
    dockerfile: 'dockerfile',
    makefile: 'makefile',
  };
  return langMap[ext] || 'text';
}

/** Monaco names a few languages differently from the LSP specification. */
export function toMonacoLanguageId(languageId: string): string {
  if (languageId === 'typescriptreact') return 'typescript';
  if (languageId === 'javascriptreact') return 'javascript';
  if (languageId === 'shellscript') return 'shell';
  if (languageId === 'jsonc') return 'json';
  return languageId;
}
