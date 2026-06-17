/**
 * lang — language detection and icon utilities for the diff component.
 *
 * `langFromPath`  extracts the file extension and returns a canonical language
 *                 string compatible with highlightCode() in highlighter.ts.
 * `LangIcon`      maps extensions to a simple text glyph with a generic fallback.
 *                 Richer icon integration is a future enhancement.
 */

// ── Language detection ────────────────────────────────────────────────────────

const EXT_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  css: 'css',
  html: 'html',
  md: 'markdown',
  mdx: 'markdown',
  rs: 'rust',
  go: 'go',
  rb: 'ruby',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  sql: 'sql',
};

/** Extract a canonical language name from a file path (using the extension). */
export function langFromPath(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase();
  if (!ext) return undefined;
  return EXT_LANG[ext];
}

/** Return just the file extension (lowercase) from a path. */
export function extFromPath(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? '';
}

// ── Language icon glyphs ──────────────────────────────────────────────────────

const EXT_GLYPH: Record<string, string> = {
  ts: 'TS',
  tsx: 'TSX',
  js: 'JS',
  jsx: 'JSX',
  mjs: 'JS',
  cjs: 'JS',
  py: 'PY',
  sh: 'SH',
  bash: 'SH',
  zsh: 'SH',
  json: '{}',
  jsonc: '{}',
  yaml: 'YML',
  yml: 'YML',
  toml: 'TOM',
  md: 'MD',
  mdx: 'MDX',
  css: 'CSS',
  html: 'HTML',
  rs: 'RS',
  go: 'GO',
  rb: 'RB',
  java: 'JV',
  kt: 'KT',
  swift: 'SW',
  sql: 'SQL',
};

/** Return a short text glyph representing the file language. Falls back to the
 *  extension in uppercase, or '◻' for unknown types. */
export function langGlyph(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const glyph = EXT_GLYPH[ext] ?? ext.toUpperCase().slice(0, 3);
  return glyph || '◻';
}
