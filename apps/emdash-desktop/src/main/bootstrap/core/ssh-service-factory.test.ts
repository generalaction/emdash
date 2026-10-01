import { createScope } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import { BrowserWindow, dialog } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppDb } from '@core/services/app-db/node/db';
import type { SshCredentialService } from '@core/services/ssh/node/credentials/ssh-credential-service';
import { SshConnectionManager } from '@core/services/ssh/node/lifecycle/ssh-connection-manager';
import { connectOpenSsh } from '@core/services/ssh/node/openssh/session';
import { fakeSession } from '@core/services/ssh/node/openssh/testing/session';
import { createSshService } from './ssh-service-factory';

vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  dialog: { showMessageBox: vi.fn() },
}));
vi.mock('@core/services/ssh/node/openssh/session', () => ({ connectOpenSsh: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('createSshService', () => {
  it('owns a child scope and disconnects the manager exactly once', async () => {
    const scope = createScope({ label: 'ssh-factory-test' });
    const disconnectAll = vi
      .spyOn(SshConnectionManager.prototype, 'disconnectAll')
      .mockResolvedValue();
    const credentials = {
      getPassword: vi.fn(async () => null),
      getPassphrase: vi.fn(async () => null),
      storePassword: vi.fn(),
      storePassphrase: vi.fn(),
      deleteAllCredentials: vi.fn(),
    } as unknown as SshCredentialService;
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    const handle = createSshService({
      scope,
      db: {} as AppDb,
      credentials,
      prepareCredentials: () => () => {},
      logger,
      telemetry: { capture: vi.fn() },
    });

    expect(handle.ssh).toBeDefined();
    expect(handle.machines).toBeDefined();
    // The handle exposes the primitive interface; narrow to the concrete class
    // to drive the implementation-private createConnection path.
    const manager = handle.manager;
    if (!(manager instanceof SshConnectionManager)) {
      throw new Error('expected the concrete SshConnectionManager');
    }
    await expect(
      manager.createConnection('ssh-1', async () => {
        throw new Error('Resolver failed');
      })
    ).rejects.toThrow('Resolver failed');
    expect(handle.connections.snapshot()['ssh-1']).toEqual({
      state: 'error',
      health: { status: 'ok' },
    });

    await handle.dispose();
    await handle.dispose();
    await scope.dispose();

    expect(disconnectAll).toHaveBeenCalledTimes(1);
  });
});

it.each([0, 1])('requires an explicit host-trust choice (button %s)', async (response) => {
  const scope = createScope({ label: 'host-confirmation-test' });
  const parent = {} as BrowserWindow;
  vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValueOnce(parent);
  vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response, checkboxChecked: false });
  const session = fakeSession();
  vi.mocked(connectOpenSsh).mockImplementationOnce(async (_config, options) => {
    expect(await options?.confirmHost?.('Host example; SHA256:test-fingerprint')).toBe(
      response === 1
    );
    return session;
  });
  const handle = createSshService({
    scope,
    db: {} as AppDb,
    credentials: {
      getPassword: vi.fn(),
      getPassphrase: vi.fn(),
    } as unknown as SshCredentialService,
    prepareCredentials: () => () => {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger,
    telemetry: { capture: vi.fn() },
  });
  try {
    if (!(handle.manager instanceof SshConnectionManager)) throw new Error('Expected SSH manager');
    await handle.manager.createConnection('host', async () => ({
      config: {
        destination: 'example',
        hostname: 'example',
        username: 'alice',
        args: [],
        env: {},
        readyTimeout: 1000,
      },
      debugLogs: [],
    }));
    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      parent,
      expect.objectContaining({
        detail: 'Host example; SHA256:test-fingerprint',
        defaultId: 0,
        cancelId: 0,
        buttons: ['Cancel', 'Trust and connect'],
        signal: expect.any(AbortSignal),
      })
    );
  } finally {
    await scope.dispose();
  }
});
