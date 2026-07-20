import { createScope } from '@emdash/shared/concurrency';
import { describe, expect, it, vi } from 'vitest';
import type { AppDb } from '@main/db/client';
import type { Logger } from '@main/lib/logger';
import type { SshCredentialService } from './credentials/ssh-credential-service';
import { createSshService } from './factory';
import { SshConnectionManager } from './lifecycle/ssh-connection-manager';

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
      logger,
      telemetry: { capture: vi.fn() },
    });

    expect(handle.ssh).toBeDefined();
    expect(handle.machines).toBeDefined();
    expect(handle.manager).toBeInstanceOf(SshConnectionManager);
    await expect(
      handle.manager.createConnection('ssh-1', async () => {
        throw new Error('Resolver failed');
      })
    ).rejects.toThrow('Resolver failed');
    expect(handle.connections.instance.states.runtime.snapshot().data['ssh-1']).toEqual({
      state: 'connecting',
      health: { status: 'ok' },
    });

    await handle.dispose();
    await handle.dispose();
    await scope.dispose();

    expect(disconnectAll).toHaveBeenCalledTimes(1);
  });
});
