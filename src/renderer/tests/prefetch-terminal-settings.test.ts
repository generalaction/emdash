import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  const state: {
    next: () => Promise<{ fontFamily?: string } | undefined>;
    fonts: string[];
    calls: number;
  } = {
    next: () => Promise.resolve({ fontFamily: 'Cached Mono' }),
    fonts: ['Cached Mono', 'Recovered Mono'],
    calls: 0,
  };
  return { state };
});

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    appSettings: {
      get: vi.fn(async () => {
        harness.state.calls += 1;
        return harness.state.next();
      }),
      update: vi.fn(async () => undefined),
    },
    app: {
      listInstalledFonts: vi.fn(async () => ({
        success: true,
        fonts: harness.state.fonts,
        cached: false,
      })),
    },
  },
  events: { on: () => () => {} },
}));

vi.mock('@renderer/utils/logger', () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@renderer/utils/cssVars', () => ({
  cssVar: () => '#000000',
}));

vi.mock('@xterm/xterm', () => ({ Terminal: class {} }));
vi.mock('@xterm/addon-canvas', () => ({ CanvasAddon: class {} }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));

beforeEach(async () => {
  harness.state.calls = 0;
  harness.state.next = () => Promise.resolve({ fontFamily: 'Cached Mono' });
  harness.state.fonts = ['Cached Mono', 'Recovered Mono'];
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('prefetchTerminalSettings', () => {
  it('memoizes a successful fetch', async () => {
    const { prefetchTerminalSettings } = await import('@renderer/lib/pty/pty');
    await prefetchTerminalSettings();
    await prefetchTerminalSettings();
    await prefetchTerminalSettings();
    expect(harness.state.calls).toBe(1);
  });

  it('retries after a transient failure instead of memoizing the rejection', async () => {
    harness.state.next = () => Promise.reject(new Error('transient'));
    const { prefetchTerminalSettings } = await import('@renderer/lib/pty/pty');

    await prefetchTerminalSettings();
    expect(harness.state.calls).toBe(1);

    harness.state.next = () => Promise.resolve({ fontFamily: 'Recovered Mono' });
    await prefetchTerminalSettings();
    expect(harness.state.calls).toBe(2);

    // Subsequent successful calls memoize again.
    await prefetchTerminalSettings();
    expect(harness.state.calls).toBe(2);
  });

  it('falls back to the default terminal stack when the saved font is not installed', async () => {
    harness.state.next = () => Promise.resolve({ fontFamily: 'Missing Mono' });
    harness.state.fonts = ['Cached Mono'];

    const { prefetchTerminalSettings, resolveTerminalFontFamily } = await import(
      '@renderer/lib/pty/pty'
    );
    await prefetchTerminalSettings();

    expect(resolveTerminalFontFamily('Missing Mono')).toBe(
      'Menlo, Monaco, Consolas, "Liberation Mono", monospace'
    );
  });

  it('keeps custom fonts when the installed font list contains the family', async () => {
    harness.state.next = () => Promise.resolve({ fontFamily: 'Berkeley Mono' });
    harness.state.fonts = ['Berkeley Mono'];

    const { prefetchTerminalSettings, resolveTerminalFontFamily } = await import(
      '@renderer/lib/pty/pty'
    );
    await prefetchTerminalSettings();

    expect(resolveTerminalFontFamily('Berkeley Mono')).toBe('Berkeley Mono');
  });
});
