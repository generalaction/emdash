import { describe, expect, it, vi } from 'vitest';
import { menuOpenSettingsChannel } from '@shared/events/appEvents';
import { executeCompactMenuAction, type CompactMenuActionContext } from './menu-actions';

function makeContext(): CompactMenuActionContext {
  const webContents = {
    undo: vi.fn(),
    reload: vi.fn(),
  };
  const window = {
    webContents,
    isFullScreen: vi.fn(() => false),
    setFullScreen: vi.fn(),
    minimize: vi.fn(),
    close: vi.fn(),
    isLoading: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  };

  return {
    getWindow: () => window,
    emit: vi.fn(),
    openExternal: vi.fn(),
    copyInstallationId: vi.fn(),
  };
}

describe('executeCompactMenuAction', () => {
  it('emits app-level menu events', async () => {
    const context = makeContext();

    await executeCompactMenuAction('settings', context);

    expect(context.emit).toHaveBeenCalledWith(menuOpenSettingsChannel, undefined);
  });

  it('runs webContents editing actions on the main window', async () => {
    const context = makeContext();

    await executeCompactMenuAction('undo', context);

    expect(context.getWindow()?.webContents.undo).toHaveBeenCalled();
  });

  it('toggles fullscreen through the main window', async () => {
    const context = makeContext();

    await executeCompactMenuAction('toggle-fullscreen', context);

    expect(context.getWindow()?.setFullScreen).toHaveBeenCalledWith(true);
  });
});
