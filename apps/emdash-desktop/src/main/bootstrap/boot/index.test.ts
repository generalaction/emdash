import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BootContext } from './types';

const mocks = vi.hoisted(() => ({
  background: vi.fn(),
  configureServices: vi.fn(),
  database: vi.fn(),
  gateway: vi.fn(),
  services: vi.fn(),
  window: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    error: mocks.logError,
    info: mocks.logInfo,
    warn: mocks.logWarn,
  },
}));
vi.mock('./phases/background', () => ({
  backgroundPhase: {
    name: 'background',
    run: mocks.background,
  },
}));
vi.mock('./phases/database', () => ({
  databasePhase: {
    name: 'database',
    run: mocks.database,
  },
}));
vi.mock('./phases/gateway', () => ({
  gatewayPhase: {
    name: 'gateway',
    run: mocks.gateway,
  },
}));
vi.mock('./phases/services', () => ({
  configureServicesPhase: {
    name: 'configure-services',
    run: mocks.configureServices,
  },
  servicesPhase: {
    name: 'services',
    run: mocks.services,
  },
}));
vi.mock('./phases/window', () => ({
  windowPhase: {
    name: 'window',
    critical: false,
    run: mocks.window,
  },
}));

import { finishBoot } from './index';

const context = {} as BootContext;

describe('finishBoot', () => {
  beforeEach(() => {
    for (const mock of [
      mocks.background,
      mocks.configureServices,
      mocks.database,
      mocks.gateway,
      mocks.services,
      mocks.window,
      mocks.logError,
      mocks.logInfo,
      mocks.logWarn,
    ]) {
      mock.mockReset();
    }
  });

  it('continues after a non-critical phase fails', async () => {
    const error = new Error('window setup failed');
    mocks.window.mockRejectedValue(error);

    await expect(finishBoot(context)).resolves.toBeUndefined();

    expect(mocks.background).toHaveBeenCalledOnce();
    expect(mocks.logWarn).toHaveBeenCalledWith('Non-critical boot phase failed; continuing', {
      phase: 'window',
      error,
    });
  });

  it('rethrows a critical phase failure and stops boot', async () => {
    const error = new Error('database unavailable');
    mocks.database.mockRejectedValue(error);

    await expect(finishBoot(context)).rejects.toBe(error);

    expect(mocks.services).not.toHaveBeenCalled();
    expect(mocks.window).not.toHaveBeenCalled();
  });
});
