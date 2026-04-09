import { loader } from '@monaco-editor/react';
import type * as monacoNS from 'monaco-editor';
import { cssVar } from '@renderer/utils/cssVars';

export function defineMonacoDiffThemes(monacoInstance: typeof monacoNS): void {
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

export async function registerDiffThemes(): Promise<void> {
  const monacoInstance = await loader.init();
  defineMonacoDiffThemes(monacoInstance);
}

export function getDiffThemeName(effectiveTheme: string): string {
  switch (effectiveTheme) {
    case 'dark-black':
      return 'custom-diff-black';
    case 'light':
    case 'emlight':
      return 'custom-diff-light';
    case 'dark':
    case 'emdark':
    default:
      return 'custom-diff-dark';
  }
}
