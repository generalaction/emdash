import { beforeEach, describe, expect, it, vi } from 'vitest';

const bundles = {
  controllers: {},
  database: {},
  infrastructure: {},
  runtimes: { clients: {} },
  services: {
    automations: {},
    projects: {},
    pullRequestsRegistration: {},
  },
};
const mocks = vi.hoisted(() => ({
  appScopeDispose: vi.fn(),
  background: vi.fn(),
  closeAppDb: vi.fn(),
  configureCleanup: vi.fn(),
  configureShutdownClients: vi.fn(),
  controllers: vi.fn(),
  database: vi.fn(),
  gateway: vi.fn(),
  infrastructure: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  runtimes: vi.fn(),
  services: vi.fn(),
  window: vi.fn(),
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    error: mocks.logError,
    info: mocks.logInfo,
    warn: mocks.logWarn,
  },
}));
vi.mock('@main/db/instance', () => ({
  closeAppDb: mocks.closeAppDb,
}));
vi.mock('../core/app-scope', () => ({
  appScope: { dispose: mocks.appScopeDispose },
}));
vi.mock('../shutdown', () => ({
  configureShutdownRuntimeClients: mocks.configureShutdownClients,
}));
vi.mock('../shutdown/phases', () => ({
  configureQuitCleanupServices: mocks.configureCleanup,
}));
vi.mock('./phases/background', () => ({ bootBackground: mocks.background }));
vi.mock('./phases/controllers', () => ({ bootControllers: mocks.controllers }));
vi.mock('./phases/database', () => ({ bootDatabase: mocks.database }));
vi.mock('./phases/gateway', () => ({ installGateway: mocks.gateway }));
vi.mock('./phases/infrastructure', () => ({ bootInfrastructure: mocks.infrastructure }));
vi.mock('./phases/runtimes', () => ({ bootRuntimes: mocks.runtimes }));
vi.mock('./phases/services', () => ({ bootServices: mocks.services }));
vi.mock('./phases/window', () => ({ bootWindow: mocks.window }));

import { finishBoot } from './index';

describe('finishBoot', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.database.mockResolvedValue(bundles.database);
    mocks.infrastructure.mockResolvedValue(bundles.infrastructure);
    mocks.runtimes.mockResolvedValue(bundles.runtimes);
    mocks.services.mockResolvedValue(bundles.services);
    mocks.controllers.mockResolvedValue(bundles.controllers);
  });

  it('continues after the optional background step fails', async () => {
    const error = new Error('background setup failed');
    mocks.background.mockRejectedValue(error);

    await expect(finishBoot({} as never, { windowPhaseReady: false })).resolves.toBeUndefined();

    expect(mocks.window).toHaveBeenCalledOnce();
    expect(mocks.logWarn).toHaveBeenCalledWith('Non-critical boot phase failed; continuing', {
      phase: 'background-tasks',
      error,
    });
  });

  it('rethrows a critical step failure and stops boot', async () => {
    const error = new Error('database unavailable');
    mocks.database.mockRejectedValue(error);

    await expect(finishBoot({} as never, { windowPhaseReady: false })).rejects.toBe(error);

    expect(mocks.infrastructure).not.toHaveBeenCalled();
    expect(mocks.services).not.toHaveBeenCalled();
    expect(mocks.window).not.toHaveBeenCalled();
  });

  it('disposes composed resources when a later critical step fails', async () => {
    const error = new Error('services unavailable');
    mocks.services.mockRejectedValue(error);

    await expect(finishBoot({} as never, { windowPhaseReady: false })).rejects.toBe(error);

    expect(mocks.appScopeDispose).toHaveBeenCalledWith(error);
    expect(mocks.closeAppDb).toHaveBeenCalledOnce();
    expect(mocks.controllers).not.toHaveBeenCalled();
  });
});
