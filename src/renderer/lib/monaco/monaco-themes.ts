import type { Monaco } from '@monaco-editor/react';
import { cssVar } from '@renderer/utils/cssVars';

export function defineMonacoThemes(monaco: Monaco): void {
  monaco.editor.defineTheme('custom-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': cssVar('--monaco-bg'),
      'editor.foreground': cssVar('--monaco-fg'),
      'editor.lineHighlightBackground': cssVar('--monaco-line-highlight'),
      'editorLineNumber.foreground': cssVar('--monaco-line-number'),
      'editorGutter.background': cssVar('--monaco-gutter'),
      'diffEditor.insertedTextBackground': cssVar('--monaco-inserted-text-bg'),
      'diffEditor.insertedLineBackground': cssVar('--monaco-inserted-line-bg'),
      'diffEditor.insertedTextBorder': cssVar('--monaco-inserted-text-border'),
      'diffEditor.removedTextBackground': cssVar('--monaco-removed-text-bg'),
      'diffEditor.removedLineBackground': cssVar('--monaco-removed-line-bg'),
      'diffEditor.removedTextBorder': cssVar('--monaco-removed-text-border'),
      'diffEditor.unchangedRegionBackground': cssVar('--monaco-unchanged-region-bg'),
      'diffEditor.border': cssVar('--monaco-diff-border'),
      'diffEditor.diagonalFill': cssVar('--monaco-diff-diagonal-fill'),
    },
  });

  monaco.editor.defineTheme('custom-black', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': cssVar('--monaco-bg'),
      'editor.foreground': cssVar('--monaco-fg'),
      'editor.lineHighlightBackground': cssVar('--monaco-line-highlight'),
      'editorLineNumber.foreground': cssVar('--monaco-line-number'),
      'editorGutter.background': cssVar('--monaco-gutter'),
      'diffEditor.insertedTextBackground': cssVar('--monaco-inserted-text-bg'),
      'diffEditor.insertedLineBackground': cssVar('--monaco-inserted-line-bg'),
      'diffEditor.insertedTextBorder': cssVar('--monaco-inserted-text-border'),
      'diffEditor.removedTextBackground': cssVar('--monaco-removed-text-bg'),
      'diffEditor.removedTextBorder': cssVar('--monaco-removed-text-border'),
      'diffEditor.removedLineBackground': cssVar('--monaco-removed-line-bg'),
      'diffEditor.unchangedRegionBackground': cssVar('--monaco-unchanged-region-bg'),
      'diffEditor.border': cssVar('--monaco-diff-border'),
      'diffEditor.diagonalFill': cssVar('--monaco-diff-diagonal-fill'),
    },
  });

  monaco.editor.defineTheme('custom-light', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': cssVar('--monaco-bg'),
      'editor.foreground': cssVar('--monaco-fg'),
      'editor.lineHighlightBackground': cssVar('--monaco-line-highlight'),
      'editorLineNumber.foreground': cssVar('--monaco-line-number'),
      'editorGutter.background': cssVar('--monaco-gutter'),
      'diffEditor.insertedTextBackground': cssVar('--monaco-inserted-text-bg'),
      'diffEditor.insertedLineBackground': cssVar('--monaco-inserted-line-bg'),
      'diffEditor.insertedTextBorder': cssVar('--monaco-inserted-text-border'),
      'diffEditor.removedTextBackground': cssVar('--monaco-removed-text-bg'),
      'diffEditor.removedLineBackground': cssVar('--monaco-removed-line-bg'),
      'diffEditor.removedTextBorder': cssVar('--monaco-removed-text-border'),
      'diffEditor.unchangedRegionBackground': cssVar('--monaco-unchanged-region-bg'),
      'diffEditor.border': cssVar('--monaco-diff-border'),
      'diffEditor.diagonalFill': cssVar('--monaco-diff-diagonal-fill'),
    },
  });
}

export function getMonacoTheme(effectiveTheme: string): string {
  switch (effectiveTheme) {
    case 'dark-black':
      return 'custom-black';
    case 'dark':
    case 'emdark':
      return 'custom-dark';
    case 'light':
    case 'emlight':
    default:
      return 'custom-light';
  }
}

export function applyMonacoTheme(monaco: Monaco, effectiveTheme: string): void {
  defineMonacoThemes(monaco);
  monaco.editor.setTheme(getMonacoTheme(effectiveTheme));
}

export function setupMonacoTheme(monaco: Monaco, effectiveTheme: string): string {
  defineMonacoThemes(monaco);
  return getMonacoTheme(effectiveTheme);
}
