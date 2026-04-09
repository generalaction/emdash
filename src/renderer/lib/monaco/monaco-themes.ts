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
    },
  });
}

export function getMonacoTheme(effectiveTheme: string): string {
  switch (effectiveTheme) {
    case 'dark-black':
      return 'custom-black';
    case 'dark':
      return 'custom-dark';
    case 'light':
    case 'emlight':
      return 'custom-light';
    case 'emdark':
      return 'custom-dark';
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
