import { runtimeHostUnavailable } from '@emdash/core/primitives/runtime-resolution/api';
import { describe, expect, it, vi } from 'vitest';
import type { SshService } from '@core/primitives/ssh/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { reconnectIntendedSshConnections } from './infrastructure';

const warn = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0' },
  powerMonitor: { on: vi.fn(), off: vi.fn() },
  safeStorage: {},
}));

vi.mock('@main/lib/logger', () => {
  const log = { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn(), child: () => log };
  return { log };
});

describe('reconnectIntendedSshConnections', () => {
  it('logs the resolver failure message when a reconnect is rejected', async () => {
    const db = {
      select: () => ({ from: () => ({ where: async () => [{ id: 'conn-1' }] }) }),
    } as unknown as AppDb;
    const ssh = {
      ensureConnected: () =>
        Promise.reject(
          runtimeHostUnavailable(
            { type: 'remote', id: 'conn-1' },
            'connection-failed',
            'All configured authentication methods failed'
          )
        ),
    } as unknown as SshService;

    await reconnectIntendedSshConnections(db, ssh);

    expect(warn).toHaveBeenCalledWith('Failed to reconnect intended SSH connection', {
      connectionId: 'conn-1',
      error: expect.objectContaining({ message: 'All configured authentication methods failed' }),
    });
  });
});
