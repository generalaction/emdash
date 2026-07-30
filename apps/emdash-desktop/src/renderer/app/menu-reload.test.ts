import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  eventOn: vi.fn(),
  findById: vi.fn(),
  reloadApp: vi.fn(),
}));

vi.mock('@renderer/lib/commands/registry', () => ({
  commandRegistry: { findById: mocks.findById },
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: { on: mocks.eventOn },
}));

const { reloadActiveBrowserOrApp, wireMenuReload } = await import('./menu-reload');

describe('menu reload handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('window', { location: { reload: mocks.reloadApp } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('wires the listener during renderer startup', () => {
    wireMenuReload();

    expect(mocks.eventOn).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'menu:reload' }),
      reloadActiveBrowserOrApp
    );
  });

  it('resolves the current active browser command for every reload', () => {
    const reloadFirstBrowser = vi.fn();
    const reloadSecondBrowser = vi.fn();
    mocks.findById.mockReturnValueOnce({ enabled: true, execute: reloadFirstBrowser });
    mocks.findById.mockReturnValueOnce({ enabled: true, execute: reloadSecondBrowser });

    reloadActiveBrowserOrApp();
    reloadActiveBrowserOrApp();

    expect(mocks.findById).toHaveBeenNthCalledWith(1, 'task.browserReload');
    expect(mocks.findById).toHaveBeenNthCalledWith(2, 'task.browserReload');
    expect(reloadFirstBrowser).toHaveBeenCalledOnce();
    expect(reloadSecondBrowser).toHaveBeenCalledOnce();
    expect(mocks.reloadApp).not.toHaveBeenCalled();
  });

  it('reloads Emdash when the browser reload command is disabled', () => {
    mocks.findById.mockReturnValue({ enabled: false, execute: vi.fn() });

    reloadActiveBrowserOrApp();

    expect(mocks.reloadApp).toHaveBeenCalledOnce();
  });

  it('reloads Emdash when there is no task command provider', () => {
    mocks.findById.mockReturnValue(undefined);

    reloadActiveBrowserOrApp();

    expect(mocks.reloadApp).toHaveBeenCalledOnce();
  });
});
