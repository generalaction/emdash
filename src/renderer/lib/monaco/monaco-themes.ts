import type { Monaco } from '@monaco-editor/react';

const MONACO_THEME_COLORS = {
  'custom-dark': {
    'editor.background': '#191919',
    'editor.foreground': '#b4b4b4',
    'editor.lineHighlightBackground': '#313131',
    'editorLineNumber.foreground': '#3a3a3a',
    'editorGutter.background': '#f8fafc',
    'diffEditor.insertedTextBackground': '#25482d',
    'diffEditor.insertedLineBackground': '#1b2a1e',
    'diffEditor.insertedTextBorder': '#25482d',
    'diffEditor.removedTextBackground': '#611623',
    'diffEditor.removedLineBackground': '#3b1219',
    'diffEditor.removedTextBorder': '#611623',
    'diffEditor.unchangedRegionBackground': '#2a2a2a',
    'diffEditor.border': '#3a3a3a',
    'diffEditor.diagonalFill': '#2a2a2a',
  },
  'custom-black': {
    'editor.background': '#000000',
    'editor.foreground': '#f2f2f2',
    'editor.lineHighlightBackground': '#1a1a1a',
    'editorLineNumber.foreground': '#666666',
    'editorGutter.background': '#000000',
    'diffEditor.insertedTextBackground': '#064e3b5c',
    'diffEditor.insertedLineBackground': '#064e3b73',
    'diffEditor.removedTextBackground': '#8813375c',
    'diffEditor.removedLineBackground': '#88133773',
    'diffEditor.unchangedRegionBackground': '#0a0a0a',
  },
  'custom-light': {
    'editor.background': '#f8fafc',
    'editor.foreground': '#1e293b',
    'editor.lineHighlightBackground': '#f1f5f9',
    'editorLineNumber.foreground': '#94a3b8',
    'editorGutter.background': '#f8fafc',
    'diffEditor.insertedTextBackground': '#10b98140',
    'diffEditor.insertedLineBackground': '#ecfdf580',
    'diffEditor.removedTextBackground': '#f43f5e40',
    'diffEditor.removedLineBackground': '#fff1f280',
    'diffEditor.unchangedRegionBackground': '#e2e8f0',
  },
} as const;

export function defineMonacoThemes(monaco: Monaco): void {
  monaco.editor.defineTheme('custom-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: MONACO_THEME_COLORS['custom-dark'],
  });

  monaco.editor.defineTheme('custom-black', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: MONACO_THEME_COLORS['custom-black'],
  });

  monaco.editor.defineTheme('custom-light', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: MONACO_THEME_COLORS['custom-light'],
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
