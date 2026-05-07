import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  const widths: Record<string, number> = {};
  return { widths };
});

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    appSettings: { get: async () => ({ fontFamily: '' }), update: async () => undefined },
  },
  events: { on: () => () => {} },
}));
vi.mock('@renderer/utils/logger', () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@renderer/utils/cssVars', () => ({ cssVar: () => '#000000' }));
vi.mock('@xterm/xterm', () => ({ Terminal: class {} }));
vi.mock('@xterm/addon-canvas', () => ({ CanvasAddon: class {} }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));

beforeEach(() => {
  vi.resetModules();
  for (const key of Object.keys(harness.widths)) delete harness.widths[key];

  class FakeContext {
    font = '';
    measureText() {
      return { width: harness.widths[this.font] ?? 100 };
    }
  }
  class FakeCanvas {
    getContext() {
      return new FakeContext();
    }
  }
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      if (tag === 'canvas') return new FakeCanvas();
      throw new Error(`unexpected createElement: ${tag}`);
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isFontAvailable', () => {
  it('returns false when the candidate width matches every fallback', async () => {
    harness.widths['72px monospace'] = 100;
    harness.widths['72px serif'] = 110;
    harness.widths['72px sans-serif'] = 120;
    harness.widths['72px "Bogus Font", monospace'] = 100;
    harness.widths['72px "Bogus Font", serif'] = 110;
    harness.widths['72px "Bogus Font", sans-serif'] = 120;

    const { isFontAvailable } = await import('@renderer/lib/pty/pty');
    expect(isFontAvailable('Bogus Font')).toBe(false);
  });

  it('returns true when the candidate width differs from at least one fallback', async () => {
    harness.widths['72px monospace'] = 100;
    harness.widths['72px serif'] = 110;
    harness.widths['72px sans-serif'] = 120;
    harness.widths['72px "Berkeley Mono", monospace'] = 100;
    harness.widths['72px "Berkeley Mono", serif'] = 105;
    harness.widths['72px "Berkeley Mono", sans-serif'] = 105;

    const { isFontAvailable } = await import('@renderer/lib/pty/pty');
    expect(isFontAvailable('Berkeley Mono')).toBe(true);
  });

  it('returns false for an empty or whitespace candidate', async () => {
    const { isFontAvailable } = await import('@renderer/lib/pty/pty');
    expect(isFontAvailable('')).toBe(false);
    expect(isFontAvailable('   ')).toBe(false);
  });
});

describe('prefetchTerminalSettings + font validation', () => {
  it('drops a saved font that the system does not have installed and clears it from settings', async () => {
    harness.widths['72px monospace'] = 100;
    harness.widths['72px serif'] = 110;
    harness.widths['72px sans-serif'] = 120;
    harness.widths['72px "Missing Mono", monospace'] = 100;
    harness.widths['72px "Missing Mono", serif'] = 110;
    harness.widths['72px "Missing Mono", sans-serif'] = 120;

    const update = vi.fn(async () => undefined);
    vi.doMock('@renderer/lib/ipc', () => ({
      rpc: {
        appSettings: {
          get: async () => ({ fontFamily: 'Missing Mono' }),
          update,
        },
      },
      events: { on: () => () => {} },
    }));

    const { prefetchTerminalSettings, setCachedFontFamily, isFontAvailable } = await import(
      '@renderer/lib/pty/pty'
    );
    await prefetchTerminalSettings();
    // The clear-from-settings call is fired-and-forgotten inside prefetch.
    // Allow microtasks to drain.
    await new Promise((r) => setTimeout(r, 0));

    expect(update).toHaveBeenCalledWith('terminal', { fontFamily: '' });

    // setCachedFontFamily round-trip: writing a missing font must also fall back.
    setCachedFontFamily('Missing Mono');
    expect(isFontAvailable('Missing Mono')).toBe(false);
  });

  it('does not call update when the saved font is available', async () => {
    harness.widths['72px monospace'] = 100;
    harness.widths['72px serif'] = 110;
    harness.widths['72px sans-serif'] = 120;
    harness.widths['72px "Real Mono", monospace'] = 95;
    harness.widths['72px "Real Mono", serif'] = 95;
    harness.widths['72px "Real Mono", sans-serif'] = 95;

    const update = vi.fn(async () => undefined);
    vi.doMock('@renderer/lib/ipc', () => ({
      rpc: {
        appSettings: {
          get: async () => ({ fontFamily: 'Real Mono' }),
          update,
        },
      },
      events: { on: () => () => {} },
    }));

    const { prefetchTerminalSettings } = await import('@renderer/lib/pty/pty');
    await prefetchTerminalSettings();
    await new Promise((r) => setTimeout(r, 0));

    expect(update).not.toHaveBeenCalled();
  });
});
