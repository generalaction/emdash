/**
 * Monaco Editor theme configurations
 * Centralized theme definitions for all Monaco instances in the app
 */

import type { Monaco } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

// Track if themes have been registered
let themesRegistered = false;

/**
 * Define custom themes for Monaco editor
 * This function is idempotent - calling it multiple times is safe
 */
export function defineMonacoThemes(monaco: Monaco): void {
  if (themesRegistered) return;

  // Dark theme matching app's dark mode
  monaco.editor.defineTheme('custom-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#1e293b', // slate-800 - matches app dark background
      'editor.foreground': '#e2e8f0',
      'editor.lineHighlightBackground': '#334155',
      'editorLineNumber.foreground': '#64748b',
      'editorGutter.background': '#1e293b',
    },
  });

  // Pure black theme for OLED displays
  monaco.editor.defineTheme('custom-black', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#000000', // pure black
      'editor.foreground': '#f2f2f2',
      'editor.lineHighlightBackground': '#1a1a1a',
      'editorLineNumber.foreground': '#666666',
      'editorGutter.background': '#000000',
    },
  });

  // Light theme matching app's light mode
  monaco.editor.defineTheme('custom-light', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#f8fafc', // slate-50 - matches app light background
      'editor.foreground': '#1e293b',
      'editor.lineHighlightBackground': '#f1f5f9',
      'editorLineNumber.foreground': '#94a3b8',
      'editorGutter.background': '#f8fafc',
    },
  });

  themesRegistered = true;
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
 * Configure Monaco editor with themes and return theme name
 * Convenience function that combines theme definition and selection
 */
export function setupMonacoTheme(monaco: Monaco, effectiveTheme: string): string {
  defineMonacoThemes(monaco);
  return getMonacoTheme(effectiveTheme);
}
