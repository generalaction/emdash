import { describe, expect, it, vi } from 'vitest';
import type { ConnectionState } from '@core/primitives/ssh/api';
import type { AppDb } from '@core/services/app-db/node/db';
import type { SshConnectionRow } from '@core/services/app-db/node/schema';
import type { SshConnectResult } from './connect/resolve-ssh-connect-config';
import type { SshConnectionManager } from './lifecycle/ssh-connection-manager';
import { SshService } from './ssh-service';
describe('SshService connection intent', () => {
  it('records explicit connect intent before connecting persisted config', async () => {
    const fixture = createIntentFixture({ shouldConnect: null, now: 1_700_000_000_000 });

    await expect(fixture.service.connect('ssh-1')).resolves.toBe('connected');

    expect(fixture.updateSets).toEqual([
      {
        shouldConnect: 1,
        updatedAt: '2023-11-14T22:13:20.000Z',
      },
    ]);
    expect(fixture.manager.createConnection).toHaveBeenCalledWith('ssh-1', expect.any(Function));
    expect(fixture.resolveConnectConfig).toHaveBeenCalledWith({
      kind: 'persisted',
      row: fixture.row,
    });
  });

  it('records explicit disconnect intent before dropping active connections', async () => {
    const fixture = createIntentFixture({
      shouldConnect: 1,
      state: 'connected',
      now: 1_700_000_000_000,
    });

    await fixture.service.disconnect('ssh-1');

    expect(fixture.updateSets).toEqual([
      {
        shouldConnect: 0,
        updatedAt: '2023-11-14T22:13:20.000Z',
      },
    ]);
    expect(fixture.manager.dropConnection).toHaveBeenCalledWith('ssh-1');
  });

  it('refuses implicit connects for deliberately disconnected machines', async () => {
    const fixture = createIntentFixture({ shouldConnect: 0 });

    await expect(fixture.service.ensureConnected('ssh-1')).resolves.toBe('disconnected');

    expect(fixture.updateSets).toEqual([]);
    expect(fixture.manager.createConnection).not.toHaveBeenCalled();
    expect(fixture.resolveConnectConfig).not.toHaveBeenCalled();
  });

  it('allows implicit connects when intent is unset without changing intent', async () => {
    const fixture = createIntentFixture({ shouldConnect: null });

    await expect(fixture.service.ensureConnected('ssh-1')).resolves.toBe('connected');

    expect(fixture.updateSets).toEqual([]);
    expect(fixture.manager.createConnection).toHaveBeenCalledWith('ssh-1', expect.any(Function));
    expect(fixture.resolveConnectConfig).toHaveBeenCalledWith({
      kind: 'persisted',
      row: fixture.row,
    });
  });
});

function createIntentFixture(options: {
  shouldConnect: number | null;
  state?: ConnectionState;
  now?: number;
}) {
  const row = {
    id: 'ssh-1',
    name: 'Corp',
    host: 'corp.example.com',
    port: 22,
    username: 'alice',
    authType: 'agent',
    privateKeyPath: null,
    useAgent: 1,
    metadata: {},
    shouldConnect: options.shouldConnect,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as SshConnectionRow;
  const updateSets: unknown[] = [];
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => [row]),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((value: unknown) => {
        updateSets.push(value);
        return { where: vi.fn(async () => {}) };
      }),
    })),
  } as unknown as AppDb;
  const manager = {
    createConnection: vi.fn(
      async (_connectionId: string, resolve: () => Promise<SshConnectResult>) => {
        await resolve();
      }
    ),
    dropConnection: vi.fn(async () => {}),
    getConnectionState: vi.fn(() => options.state ?? 'connected'),
  } as unknown as SshConnectionManager;
  const resolveConnectConfig = vi.fn(
    async (): Promise<SshConnectResult> => ({
      config: {
        destination: 'corp.example.com',
        hostname: 'corp.example.com',
        username: 'alice',
        args: [],
        env: {},
        readyTimeout: 1000,
      },
      debugLogs: [],
    })
  );
  const service = new SshService({
    db,
    manager,
    runtime: { remove: vi.fn() },
    resolveConnectConfig,
    parseSshConfigFile: vi.fn(),
    resolveSshConfig: vi.fn(),
    telemetry: { capture: vi.fn() },
    log: { warn: vi.fn() },
    now: () => options.now ?? 0,
  });

  return {
    service,
    db,
    manager,
    row,
    updateSets,
    resolveConnectConfig,
  };
}

describe('SshService.testConnection', () => {
  it('loads the saved identity for an edit but tests the draft on a separate connection', async () => {
    const fixture = createIntentFixture({ shouldConnect: 1 });
    const draft = {
      id: 'ssh-1',
      name: 'Edited',
      host: 'edited.example.com',
      port: 22,
      username: 'alice',
      authType: 'agent' as const,
    };
    await expect(fixture.service.testConnection(draft)).resolves.toMatchObject({ success: true });
    expect(fixture.resolveConnectConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'transient',
        config: draft,
        previous: expect.objectContaining({ id: 'ssh-1', host: 'corp.example.com' }),
      })
    );
    expect(fixture.updateSets).toEqual([]);
    expect(fixture.manager.dropConnection).not.toHaveBeenCalledWith('ssh-1');
  });

  it('maps configuration errors and still drops the ephemeral connection', async () => {
    const f = createIntentFixture({ shouldConnect: 1 });
    f.resolveConnectConfig.mockRejectedValueOnce(new Error('Invalid key path'));
    const result = await f.service.testConnection({
      id: 'ssh-1',
      name: 'Edit',
      host: 'host',
      port: 22,
      username: 'alice',
      authType: 'key',
    });
    expect(result).toMatchObject({ success: false, error: 'Invalid key path' });
    expect(f.manager.dropConnection).toHaveBeenCalledOnce();
    expect(f.updateSets).toEqual([]);
  });
});
