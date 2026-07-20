import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appOn: vi.fn(),
  initializeFileLogger: vi.fn(),
  initializeUpdater: vi.fn(),
  showRecoveryWindow: vi.fn(),
  showErrorBox: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    on: mocks.appOn,
    whenReady: vi.fn(async () => {}),
  },
  dialog: {
    showErrorBox: mocks.showErrorBox,
  },
}));
vi.mock('@main/host/file-logger', () => ({
  initializeFileLogger: mocks.initializeFileLogger,
}));
vi.mock('@main/host/recovery/recovery-window', () => ({
  showRecoveryWindow: mocks.showRecoveryWindow,
}));
vi.mock('@main/host/updates/update-service', () => ({
  updateService: { initialize: mocks.initializeUpdater },
}));
vi.mock('@main/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn() },
}));

import { enterSafeMode } from './recovery';

beforeEach(() => {
  mocks.initializeFileLogger.mockReset();
  mocks.initializeUpdater.mockReset().mockResolvedValue(undefined);
  mocks.showRecoveryWindow.mockReset().mockResolvedValue(undefined);
  mocks.showErrorBox.mockReset();
});

it('initializes the updater and opens the recovery window', async () => {
  await enterSafeMode(new Error('database unavailable'));

  expect(mocks.initializeFileLogger).toHaveBeenCalledOnce();
  expect(mocks.initializeUpdater).toHaveBeenCalledOnce();
  expect(mocks.showRecoveryWindow).toHaveBeenCalledWith({
    errorMessage: 'database unavailable',
  });
});

it('still opens recovery when updater initialization fails', async () => {
  mocks.initializeUpdater.mockRejectedValue(new Error('updater unavailable'));

  await enterSafeMode(new Error('boot failed'));

  expect(mocks.showRecoveryWindow).toHaveBeenCalledWith({ errorMessage: 'boot failed' });
  expect(mocks.showErrorBox).not.toHaveBeenCalled();
});
