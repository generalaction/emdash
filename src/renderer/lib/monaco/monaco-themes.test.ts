import { describe, expect, it, vi } from 'vitest';
import { defineMonacoThemes, getMonacoTheme } from './monaco-themes';

describe('defineMonacoThemes', () => {
  it('defines Monaco themes without reading runtime CSS variables', () => {
    const defineTheme = vi.fn();
    const monaco = {
      editor: {
        defineTheme,
      },
    };

    defineMonacoThemes(monaco as Parameters<typeof defineMonacoThemes>[0]);

    expect(defineTheme).toHaveBeenCalledTimes(3);
    expect(defineTheme).toHaveBeenNthCalledWith(
      1,
      'custom-dark',
      expect.objectContaining({
        base: 'vs-dark',
        colors: expect.objectContaining({
          'editor.background': '#191919',
          'diffEditor.removedLineBackground': '#3b1219',
        }),
      })
    );
    expect(defineTheme).toHaveBeenNthCalledWith(
      2,
      'custom-black',
      expect.objectContaining({
        base: 'vs-dark',
        colors: expect.objectContaining({
          'editor.background': '#000000',
          'diffEditor.insertedLineBackground': '#064e3b73',
        }),
      })
    );
    expect(defineTheme).toHaveBeenNthCalledWith(
      3,
      'custom-light',
      expect.objectContaining({
        base: 'vs',
        colors: expect.objectContaining({
          'editor.background': '#f8fafc',
          'diffEditor.unchangedRegionBackground': '#e2e8f0',
        }),
      })
    );
  });
});

describe('getMonacoTheme', () => {
  it('maps app themes to Monaco theme ids', () => {
    expect(getMonacoTheme('emlight')).toBe('custom-light');
    expect(getMonacoTheme('emdark')).toBe('custom-dark');
    expect(getMonacoTheme('dark-black')).toBe('custom-black');
  });
});
