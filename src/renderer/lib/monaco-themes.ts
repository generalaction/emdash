/**
 * Monaco Editor theme configurations
 * Centralized theme definitions for all Monaco instances in the app.
 * Colors are read from CSS variables at call time so theme switches are always fresh.
 */

import type { Monaco } from '@monaco-editor/react';
import { cssVar } from './cssVars';

/**
 * Define custom themes for Monaco editor.
 * Re-reads CSS variables every call so the active theme's colors are always current.
 */
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

/**
 * Get the appropriate Monaco theme name based on the app's effective theme
 */
export function getMonacoTheme(effectiveTheme: string): string {
  switch (effectiveTheme) {
    case 'dark-black':
      return 'custom-black';
    case 'dark':
      return 'custom-dark';
    case 'light':
    default:
      return 'custom-light';
  }
}

/**
 * Re-define all themes from current CSS vars, then set the active theme.
 * Call this whenever the app theme changes.
 */
export function applyMonacoTheme(monaco: Monaco, effectiveTheme: string): void {
  defineMonacoThemes(monaco);
  monaco.editor.setTheme(getMonacoTheme(effectiveTheme));
}

/**
 * Configure Monaco editor with themes and return theme name.
 * Convenience function that combines theme definition and selection.
 */
export function setupMonacoTheme(monaco: Monaco, effectiveTheme: string): string {
  defineMonacoThemes(monaco);
  return getMonacoTheme(effectiveTheme);
}
