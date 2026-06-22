import { Terminal } from '@xterm/xterm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function getPtyModule() {
  return import('@renderer/lib/pty/pty');
}

function getThemeColors(terminal: Terminal): {
  foreground?: { css: string };
  background?: { css: string };
} {
  return (
    (
      terminal as unknown as {
        _core?: {
          _themeService?: {
            colors?: { foreground?: { css: string }; background?: { css: string } };
          };
        };
      }
    )._core?._themeService?.colors ?? {}
  );
}

async function writeTerminal(terminal: Terminal, data: string): Promise<void> {
  await new Promise<void>((resolve) => terminal.write(data, resolve));
}

describe('FrontendPty xterm host', () => {
  beforeEach(() => {
    vi.stubGlobal('electronAPI', {
      eventOn: vi.fn(() => () => {}),
      eventSend: vi.fn(),
      invoke: vi.fn(() => Promise.resolve({ success: true, data: null })),
    });

    document.documentElement.style.setProperty('--xterm-bg', '#101010');
    document.documentElement.style.setProperty('--xterm-fg', '#f0f0f0');
    document.documentElement.style.setProperty('--xterm-cursor', '#f0f0f0');
    document.documentElement.style.setProperty('--xterm-cursor-accent', '#101010');
    document.documentElement.style.setProperty('--xterm-selection-bg', '#335577');
    document.documentElement.style.setProperty('--xterm-selection-fg', '#ffffff');
  });

  afterEach(async () => {
    const { disposeAllPtys } = await getPtyModule();
    disposeAllPtys();
    document.querySelector('[data-terminal-host="true"]')?.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('opens xterm only after its container is connected to the off-screen host', async () => {
    const originalOpen = Terminal.prototype.open;
    const openCall: { parent?: HTMLElement } = {};

    vi.spyOn(Terminal.prototype, 'open').mockImplementation(function open(this: Terminal, parent) {
      openCall.parent = parent;
      return originalOpen.call(this, parent);
    });

    const { FrontendPty } = await getPtyModule();
    const frontendPty = new FrontendPty('test-session');
    const host = document.querySelector('[data-terminal-host="true"]');
    const dims =
      (
        frontendPty.terminal as unknown as {
          _core?: {
            _renderService?: { dimensions?: { css: { cell: { width: number; height: number } } } };
            renderService?: { dimensions?: { css: { cell: { width: number; height: number } } } };
          };
        }
      )._core?._renderService?.dimensions ??
      (
        frontendPty.terminal as unknown as {
          _core?: {
            renderService?: { dimensions?: { css: { cell: { width: number; height: number } } } };
          };
        }
      )._core?.renderService?.dimensions;

    expect(host).toBeTruthy();
    expect(openCall.parent).toBe(frontendPty.ownedContainer);
    expect(openCall.parent?.isConnected).toBe(true);
    expect(openCall.parent?.parentElement).toBe(host);
    expect(dims?.css.cell.width).toBeGreaterThan(0);
    expect(dims?.css.cell.height).toBeGreaterThan(0);
  });

  it('keeps app theme colors when a CLI emits OSC default color overrides', async () => {
    const { FrontendPty } = await getPtyModule();
    const frontendPty = new FrontendPty('test-session');
    const originalColors = getThemeColors(frontendPty.terminal);

    expect(frontendPty.terminal.options.minimumContrastRatio).toBe(4.5);

    await writeTerminal(frontendPty.terminal, '\x1b]10;rgb:ffff/ffff/ffff\x1b\\');
    await writeTerminal(frontendPty.terminal, '\x1b]11;rgb:ffff/ffff/ffff\x1b\\');

    const colors = getThemeColors(frontendPty.terminal);
    expect(colors.foreground?.css).toBe(originalColors.foreground?.css);
    expect(colors.background?.css).toBe(originalColors.background?.css);
    expect(colors.background?.css).toBe('#101010');
  });

  it('subsequent calls recreate host if the previous host was removed from the DOM', async () => {
    const originalOpen = Terminal.prototype.open;
    const openCall: { parent?: HTMLElement } = {};

    vi.spyOn(Terminal.prototype, 'open').mockImplementation(function open(this: Terminal, parent) {
      openCall.parent = parent;
      return originalOpen.call(this, parent);
    });

    const { FrontendPty } = await getPtyModule();
    const frontendPty = new FrontendPty('test-session');
    const host = document.querySelector('[data-terminal-host="true"]');
    const dims =
      (
        frontendPty.terminal as unknown as {
          _core?: {
            _renderService?: { dimensions?: { css: { cell: { width: number; height: number } } } };
            renderService?: { dimensions?: { css: { cell: { width: number; height: number } } } };
          };
        }
      )._core?._renderService?.dimensions ??
      (
        frontendPty.terminal as unknown as {
          _core?: {
            renderService?: { dimensions?: { css: { cell: { width: number; height: number } } } };
          };
        }
      )._core?.renderService?.dimensions;

    expect(host).toBeTruthy();
    expect(openCall.parent).toBe(frontendPty.ownedContainer);
    expect(openCall.parent?.isConnected).toBe(true);
    expect(openCall.parent?.parentElement).toBe(host);
    expect(dims?.css.cell.width).toBeGreaterThan(0);
    expect(dims?.css.cell.height).toBeGreaterThan(0);
  });
});
