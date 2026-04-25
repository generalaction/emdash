// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineMonacoThemes, getMonacoTheme } from './monaco-themes';

function makeCanvasMock(r: number, g: number, b: number, a = 255) {
  return {
    width: 0,
    height: 0,
    getContext: () => ({
      fillStyle: '',
      fillRect: vi.fn(),
      getImageData: () => ({ data: [r, g, b, a] }),
    }),
  };
}

describe('defineMonacoThemes', () => {
  let appendSpy: ReturnType<typeof vi.spyOn>;
  let canvasCallCount: number;

  beforeEach(() => {
    canvasCallCount = 0;

    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') {
        canvasCallCount++;
        // Alternate: odd canvas calls return a "dark" pixel, even return a "light" pixel.
        const isDark = canvasCallCount % 2 === 1;
        return makeCanvasMock(
          isDark ? 25 : 248,
          isDark ? 25 : 250,
          isDark ? 25 : 252
        ) as unknown as HTMLElement;
      }
      const el = {
        className: '',
        style: { cssText: '' },
        remove: vi.fn(),
      };
      return el as unknown as HTMLElement;
    });

    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => {
      return {
        getPropertyValue: (prop: string) => {
          const vars: Record<string, string> = {
            '--monaco-bg': 'color(display-p3 0.098 0.098 0.098)',
            '--monaco-fg': 'color(display-p3 0.706 0.706 0.706)',
            '--monaco-line-highlight': 'color(display-p3 0.192 0.192 0.192)',
            '--monaco-line-number': 'color(display-p3 0.227 0.227 0.227)',
            '--monaco-gutter': 'color(display-p3 0.973 0.980 0.988)',
            '--monaco-inserted-text-bg': 'color(display-p3 0.145 0.282 0.176)',
            '--monaco-inserted-line-bg': 'color(display-p3 0.106 0.165 0.118)',
            '--monaco-inserted-text-border': 'color(display-p3 0.145 0.282 0.176)',
            '--monaco-removed-text-bg': 'color(display-p3 0.380 0.086 0.137)',
            '--monaco-removed-line-bg': 'color(display-p3 0.231 0.071 0.098)',
            '--monaco-removed-text-border': 'color(display-p3 0.380 0.086 0.137)',
            '--monaco-unchanged-region-bg': 'color(display-p3 0.165 0.165 0.165)',
            '--monaco-diff-border': 'color(display-p3 0.227 0.227 0.227)',
            '--monaco-diff-diagonal-fill': 'color(display-p3 0.165 0.165 0.165)',
          };
          return vars[prop] ?? '';
        },
      } as unknown as CSSStyleDeclaration;
    });

    appendSpy = vi.spyOn(document.body, 'appendChild').mockReturnValue({} as Node);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defines exactly two Monaco themes', () => {
    const defineTheme = vi.fn();
    const monaco = { editor: { defineTheme } };

    defineMonacoThemes(monaco as Parameters<typeof defineMonacoThemes>[0]);

    expect(defineTheme).toHaveBeenCalledTimes(2);
  });

  it('defines custom-dark with vs-dark base', () => {
    const defineTheme = vi.fn();
    const monaco = { editor: { defineTheme } };

    defineMonacoThemes(monaco as Parameters<typeof defineMonacoThemes>[0]);

    expect(defineTheme).toHaveBeenNthCalledWith(
      1,
      'custom-dark',
      expect.objectContaining({ base: 'vs-dark', inherit: true })
    );
  });

  it('defines custom-light with vs base', () => {
    const defineTheme = vi.fn();
    const monaco = { editor: { defineTheme } };

    defineMonacoThemes(monaco as Parameters<typeof defineMonacoThemes>[0]);

    expect(defineTheme).toHaveBeenNthCalledWith(
      2,
      'custom-light',
      expect.objectContaining({ base: 'vs', inherit: true })
    );
  });

  it('reads CSS vars and converts them to hex colors', () => {
    const defineTheme = vi.fn();
    const monaco = { editor: { defineTheme } };

    defineMonacoThemes(monaco as Parameters<typeof defineMonacoThemes>[0]);

    const darkCall = defineTheme.mock.calls[0][1];
    expect(darkCall.colors['editor.background']).toMatch(/^#[0-9a-f]{6}$/i);
    expect(darkCall.colors['editor.foreground']).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('creates and appends a temp DOM element for each theme', () => {
    const defineTheme = vi.fn();
    const monaco = { editor: { defineTheme } };

    defineMonacoThemes(monaco as Parameters<typeof defineMonacoThemes>[0]);

    expect(appendSpy).toHaveBeenCalledTimes(2);
  });
});

describe('getMonacoTheme', () => {
  it('maps emlight to custom-light', () => {
    expect(getMonacoTheme('emlight')).toBe('custom-light');
  });

  it('maps emdark to custom-dark', () => {
    expect(getMonacoTheme('emdark')).toBe('custom-dark');
  });

  it('defaults unknown themes to custom-dark', () => {
    expect(getMonacoTheme('unknown')).toBe('custom-dark');
  });
});
