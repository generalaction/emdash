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
  const name = path.split(/[\\/]/).at(-1) ?? '';
  // Config files Monaco has no grammar for: borrow the closest one so they still get colors.
  if (name === '.env' || name.startsWith('.env.') || name.endsWith('.env')) return 'ini';
  if (RUBY_FILENAMES.has(name)) return 'ruby';
  if (name === 'Podfile.lock' || name === 'pubspec.lock') return 'yaml';
  const ext = name.split('.').pop()?.toLowerCase() || '';
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
    ini: 'ini',
    cfg: 'ini',
    conf: 'ini',
    properties: 'ini',
    toml: 'ini',
    xcconfig: 'ini',
    plist: 'xml',
    entitlements: 'xml',
    gradle: 'java',
  };
  return langMap[ext] || 'text';
}

/** Ruby DSL files (CocoaPods, Bundler, fastlane) that have no extension. */
const RUBY_FILENAMES = new Set([
  'Podfile',
  'Gemfile',
  'Fastfile',
  'Appfile',
  'Matchfile',
  'Pluginfile',
  'Snapfile',
  'Gymfile',
  'Deliverfile',
  'Scanfile',
]);

/** Monaco names a few languages differently from the LSP specification. */
export function toMonacoLanguageId(languageId: string): string {
  if (languageId === 'typescriptreact') return 'typescript';
  if (languageId === 'javascriptreact') return 'javascript';
  if (languageId === 'shellscript') return 'shell';
  if (languageId === 'jsonc') return 'json';
  return languageId;
}
