/**
 * Utilities for converting diff formats and working with Monaco Editor
 */

import type { DiffLine } from '../hooks/useFileDiff';
import { getLanguageFromPath } from './languageUtils';

/**
 * Convert DiffLine[] format to original/modified strings for Monaco Editor
 */
export function convertDiffLinesToMonacoFormat(lines: DiffLine[]): {
  original: string;
  modified: string;
} {
  const originalLines: string[] = [];
  const modifiedLines: string[] = [];

  for (const line of lines) {
    if (line.type === 'context') {
      // Context lines appear in both files
      const content = line.left || line.right || '';
      originalLines.push(content);
      modifiedLines.push(content);
    } else if (line.type === 'del') {
      // Deleted lines only in original
      originalLines.push(line.left || line.right || '');
    } else if (line.type === 'add') {
      // Added lines only in modified
      modifiedLines.push(line.right || line.left || '');
    }
  }

  return {
    original: originalLines.join('\n'),
    modified: modifiedLines.join('\n'),
  };
}

/**
 * Map file extensions to Monaco Editor language IDs
 * Monaco uses different IDs than Prism in some cases
 */
export function getMonacoLanguageId(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    go: 'go',
    rs: 'rust',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    scala: 'scala',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    fish: 'shell',
    yml: 'yaml',
    yaml: 'yaml',
    json: 'json',
    jsonc: 'jsonc',
    xml: 'xml',
    html: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'scss',
    less: 'less',
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
    toml: 'toml',
    ini: 'ini',
    properties: 'properties',
    log: 'plaintext',
    txt: 'plaintext',
  };

  // Check for special file names
  if (filePath.toLowerCase().includes('dockerfile')) return 'dockerfile';
  if (filePath.toLowerCase().includes('makefile')) return 'makefile';

  return langMap[ext] || 'plaintext';
}

/**
 * Check if a file is likely binary based on extension
 */
export function isBinaryFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const binaryExtensions = [
    'png',
    'jpg',
    'jpeg',
    'gif',
    'svg',
    'ico',
    'webp',
    'pdf',
    'zip',
    'tar',
    'gz',
    'bz2',
    'xz',
    '7z',
    'exe',
    'dll',
    'so',
    'dylib',
    'bin',
    'woff',
    'woff2',
    'ttf',
    'otf',
    'eot',
    'mp3',
    'mp4',
    'avi',
    'mov',
    'wmv',
    'flv',
    'webm',
    'ogg',
  ];
  return binaryExtensions.includes(ext);
}
