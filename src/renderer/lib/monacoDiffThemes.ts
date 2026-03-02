import { loader } from '@monaco-editor/react';
import { MONACO_DIFF_COLORS } from './monacoDiffColors';

let themesRegistered = false;

export async function registerDiffThemes(): Promise<void> {
  if (themesRegistered) return;

  const monacoInstance = await loader.init();

  monacoInstance.editor.defineTheme('custom-diff-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': MONACO_DIFF_COLORS.dark.editorBackground,
      'editorGutter.background': MONACO_DIFF_COLORS.dark.editorBackground,
      'diffEditor.insertedTextBackground': MONACO_DIFF_COLORS.dark.insertedTextBackground,
      'diffEditor.insertedLineBackground': MONACO_DIFF_COLORS.dark.insertedLineBackground,
      'diffEditor.removedTextBackground': MONACO_DIFF_COLORS.dark.removedTextBackground,
      'diffEditor.removedLineBackground': MONACO_DIFF_COLORS.dark.removedLineBackground,
      'diffEditor.unchangedRegionBackground': '#1a2332',
    },
  });

  monacoInstance.editor.defineTheme('custom-diff-black', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': MONACO_DIFF_COLORS['dark-black'].editorBackground,
      'editorGutter.background': MONACO_DIFF_COLORS['dark-black'].editorBackground,
      'diffEditor.insertedTextBackground': MONACO_DIFF_COLORS['dark-black'].insertedTextBackground,
      'diffEditor.insertedLineBackground': MONACO_DIFF_COLORS['dark-black'].insertedLineBackground,
      'diffEditor.removedTextBackground': MONACO_DIFF_COLORS['dark-black'].removedTextBackground,
      'diffEditor.removedLineBackground': MONACO_DIFF_COLORS['dark-black'].removedLineBackground,
      'diffEditor.unchangedRegionBackground': '#0a0a0a',
    },
  });

  monacoInstance.editor.defineTheme('custom-diff-light', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'diffEditor.insertedTextBackground': MONACO_DIFF_COLORS.light.insertedTextBackground,
      'diffEditor.insertedLineBackground': MONACO_DIFF_COLORS.light.insertedLineBackground,
      'diffEditor.removedTextBackground': MONACO_DIFF_COLORS.light.removedTextBackground,
      'diffEditor.removedLineBackground': MONACO_DIFF_COLORS.light.removedLineBackground,
      'diffEditor.unchangedRegionBackground': '#e2e8f0',
    },
  });

  themesRegistered = true;
}

export function getDiffThemeName(effectiveTheme: string): string {
  if (effectiveTheme === 'dark-black') return 'custom-diff-black';
  if (effectiveTheme === 'light') return 'custom-diff-light';
  return 'custom-diff-dark';
}
