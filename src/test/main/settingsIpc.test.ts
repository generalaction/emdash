import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — these are referenced inside vi.mock factories which are
// hoisted before variable declarations, so they must use vi.hoisted().
// ---------------------------------------------------------------------------

const { startMock, stopMock } = vi.hoisted(() => ({
  startMock: vi.fn().mockResolvedValue(undefined),
  stopMock: vi.fn(),
}));

vi.mock('../../main/services/McpTaskServer', () => ({
  mcpTaskServer: { start: (...args: any[]) => startMock(...args), stop: stopMock },
}));

vi.mock('../../main/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Settings state driven by these mocks.
let currentSettings: { mcp?: { enabled: boolean; port?: number } } = {};

const { updateAppSettingsMock } = vi.hoisted(() => ({
  updateAppSettingsMock: vi.fn((partial: any) => {
    if (partial?.mcp) {
      currentSettings = { ...currentSettings, mcp: { ...currentSettings.mcp, ...partial.mcp } };
    }
    return currentSettings;
  }),
}));

vi.mock('../../main/settings', () => ({
  getAppSettings: () => currentSettings,
  updateAppSettings: (partial: any) => updateAppSettingsMock(partial),
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/emdash-test') },
}));

import { appSettingsController } from '../../main/ipc/settingsIpc';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('settingsIpc — MCP server lifecycle on settings update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSettings = {};
    startMock.mockResolvedValue(undefined);
  });

  it('starts the server when enabled transitions false → true', async () => {
    currentSettings = { mcp: { enabled: false } };
    updateAppSettingsMock.mockImplementationOnce(() => {
      currentSettings = { mcp: { enabled: true } };
      return currentSettings;
    });

    await appSettingsController.update({ mcp: { enabled: true } } as any);

    expect(startMock).toHaveBeenCalledTimes(1);
    expect(stopMock).not.toHaveBeenCalled();
  });

  it('passes the configured port to start()', async () => {
    currentSettings = { mcp: { enabled: false } };
    updateAppSettingsMock.mockImplementationOnce(() => {
      currentSettings = { mcp: { enabled: true, port: 19000 } };
      return currentSettings;
    });

    await appSettingsController.update({ mcp: { enabled: true, port: 19000 } } as any);

    expect(startMock).toHaveBeenCalledWith(19000);
  });

  it('stops the server when enabled transitions true → false', async () => {
    currentSettings = { mcp: { enabled: true } };
    updateAppSettingsMock.mockImplementationOnce(() => {
      currentSettings = { mcp: { enabled: false } };
      return currentSettings;
    });

    await appSettingsController.update({ mcp: { enabled: false } } as any);

    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(startMock).not.toHaveBeenCalled();
  });

  it('restarts the server when the port changes while enabled', async () => {
    currentSettings = { mcp: { enabled: true, port: 17823 } };
    updateAppSettingsMock.mockImplementationOnce(() => {
      currentSettings = { mcp: { enabled: true, port: 18000 } };
      return currentSettings;
    });

    await appSettingsController.update({ mcp: { port: 18000 } } as any);

    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledWith(18000);
  });

  it('does not touch the server when an unrelated setting changes', async () => {
    currentSettings = { mcp: { enabled: false } };
    updateAppSettingsMock.mockImplementationOnce(() => currentSettings);

    await appSettingsController.update({ tasks: { autoGenerateName: false } } as any);

    expect(startMock).not.toHaveBeenCalled();
    expect(stopMock).not.toHaveBeenCalled();
  });

  it('logs a warning and does not throw when start() rejects', async () => {
    currentSettings = { mcp: { enabled: false } };
    updateAppSettingsMock.mockImplementationOnce(() => {
      currentSettings = { mcp: { enabled: true } };
      return currentSettings;
    });
    startMock.mockRejectedValueOnce(new Error('port in use'));

    await expect(
      appSettingsController.update({ mcp: { enabled: true } } as any)
    ).resolves.not.toThrow();
  });
});
