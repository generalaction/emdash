import { loader } from '@monaco-editor/react';
import { cssVar } from './cssVars';

export async function registerDiffThemes(): Promise<void> {
  const monacoInstance = await loader.init();

  monacoInstance.editor.defineTheme('custom-diff-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': cssVar('--monaco-bg'),
      'editorGutter.background': cssVar('--monaco-gutter'),
      'diffEditor.insertedTextBackground': cssVar('--monaco-inserted-text-bg'),
      'diffEditor.insertedLineBackground': cssVar('--monaco-inserted-line-bg'),
      'diffEditor.removedTextBackground': cssVar('--monaco-removed-text-bg'),
      'diffEditor.removedLineBackground': cssVar('--monaco-removed-line-bg'),
      'diffEditor.unchangedRegionBackground': cssVar('--monaco-unchanged-region-bg'),
    },
  });

  monacoInstance.editor.defineTheme('custom-diff-black', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': cssVar('--monaco-bg'),
      'editorGutter.background': cssVar('--monaco-gutter'),
      'diffEditor.insertedTextBackground': cssVar('--monaco-inserted-text-bg'),
      'diffEditor.insertedLineBackground': cssVar('--monaco-inserted-line-bg'),
      'diffEditor.removedTextBackground': cssVar('--monaco-removed-text-bg'),
      'diffEditor.removedLineBackground': cssVar('--monaco-removed-line-bg'),
      'diffEditor.unchangedRegionBackground': cssVar('--monaco-unchanged-region-bg'),
    },
  });

  monacoInstance.editor.defineTheme('custom-diff-light', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': cssVar('--monaco-bg'),
      'diffEditor.insertedTextBackground': cssVar('--monaco-inserted-text-bg'),
      'diffEditor.insertedLineBackground': cssVar('--monaco-inserted-line-bg'),
      'diffEditor.removedTextBackground': cssVar('--monaco-removed-text-bg'),
      'diffEditor.removedLineBackground': cssVar('--monaco-removed-line-bg'),
      'diffEditor.unchangedRegionBackground': cssVar('--monaco-unchanged-region-bg'),
    },
  });
}

export function getDiffThemeName(effectiveTheme: string): string {
  if (effectiveTheme === 'dark-black') return 'custom-diff-black';
  if (effectiveTheme === 'light') return 'custom-diff-light';
  return 'custom-diff-dark';
}
