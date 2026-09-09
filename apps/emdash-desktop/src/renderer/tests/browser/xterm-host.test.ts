import { Terminal } from '@xterm/xterm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { xtermThemeIntegration } from '@core/features/terminals/browser/pty/xterm-theme-integration';
import { setXtermThemeFixture } from './xterm-theme-fixture';

async function getPtyModule() {
  return import('@core/features/terminals/api/browser/pty/pty');
}

function noopConnector() {
  return {
    connect: () => () => {},
  };
}

describe('FrontendPty xterm host', () => {
  beforeEach(() => {
    vi.stubGlobal('electronAPI', {
      eventOn: vi.fn(() => () => {}),
      eventSend: vi.fn(),
      invoke: vi.fn(() => Promise.resolve({ success: true, data: null })),
    });

    setXtermThemeFixture();
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
    const frontendPty = new FrontendPty(
      'test-session',
      undefined,
      undefined,
      undefined,
      noopConnector()
    );
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

  it('subsequent calls recreate host if the previous host was removed from the DOM', async () => {
    const originalOpen = Terminal.prototype.open;
    const openCall: { parent?: HTMLElement } = {};

    vi.spyOn(Terminal.prototype, 'open').mockImplementation(function open(this: Terminal, parent) {
      openCall.parent = parent;
      return originalOpen.call(this, parent);
    });

    const { FrontendPty } = await getPtyModule();
    const frontendPty = new FrontendPty(
      'test-session',
      undefined,
      undefined,
      undefined,
      noopConnector()
    );
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

  it('re-reads the typed manifest on every Theme refresh', async () => {
    const { FrontendPty } = await getPtyModule();
    const frontendPty = new FrontendPty(
      'test-session',
      undefined,
      undefined,
      undefined,
      noopConnector()
    );

    expect(frontendPty.terminal.options.theme?.background).toBe('#101010');

    document.documentElement.style.setProperty(
      xtermThemeIntegration.properties.background,
      '#202020'
    );
    frontendPty.refreshTheme();

    expect(frontendPty.terminal.options.theme?.background).toBe('#202020');
    expect(frontendPty.terminal.element?.style.backgroundColor).toBe('rgb(32, 32, 32)');
  });
});
