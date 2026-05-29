import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

class MockClient extends EventEmitter {
  static lastInstance: MockClient | null = null;
  endCalled = false;

  constructor() {
    super();
    MockClient.lastInstance = this;
  }

  connect(_config: unknown): void {
    // no-op — tests drive 'ready' / 'error' / 'close' manually
  }

  end(): void {
    this.endCalled = true;
    // simulate ssh2 client closing after end()
    queueMicrotask(() => this.emit('close'));
  }
}

vi.mock('ssh2', () => ({
  Client: MockClient,
}));

vi.mock('@main/db/client', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: () => [] }) }) }) },
}));

vi.mock('@main/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@main/lib/events', () => ({
  events: { emit: vi.fn() },
}));

// Import AFTER mocks are registered.
const { SshConnectionManager } = await import('./ssh-connection-manager');

const baseConfig = { host: 'remote.example.com', username: 'tester' };

describe('SshConnectionManager host lifecycle', () => {
  beforeEach(() => {
    MockClient.lastInstance = null;
  });

  it('records host on successful connect and exposes it via getHost', async () => {
    const mgr = new SshConnectionManager();
    const pending = mgr.connectFromConfig('c1', baseConfig);

    // Drive a successful handshake.
    queueMicrotask(() => MockClient.lastInstance?.emit('ready'));
    await pending;

    expect(mgr.getHost('c1')).toBe('remote.example.com');
  });

  it('does not clear host when the underlying client emits close', async () => {
    const mgr = new SshConnectionManager();
    const pending = mgr.connectFromConfig('c1', baseConfig);
    queueMicrotask(() => MockClient.lastInstance?.emit('ready'));
    await pending;

    // The 'close' handler must not nuke the host map — the SshTerminalProvider
    // snapshot relies on getHost() staying valid across transient close events.
    // (Note: connectFromConfig marks the id as intentional, so scheduleReconnect
    // is not exercised here. The reconnect re-entry path is covered by the
    // 'records host on successful connect' test, since reconnect re-enters
    // connect() → createConnection() which always re-populates hosts.)
    MockClient.lastInstance?.emit('close');

    expect(mgr.getHost('c1')).toBe('remote.example.com');

    await mgr.disconnect('c1').catch(() => {});
  });

  it('clears host on intentional disconnect via the normal close branch', async () => {
    const mgr = new SshConnectionManager();
    const pending = mgr.connectFromConfig('c1', baseConfig);
    queueMicrotask(() => MockClient.lastInstance?.emit('ready'));
    await pending;

    expect(mgr.getHost('c1')).toBe('remote.example.com');

    await mgr.disconnect('c1');

    expect(mgr.getHost('c1')).toBeUndefined();
  });

  it('clears host when disconnect is called on a never-connected id (early-return branch)', async () => {
    const mgr = new SshConnectionManager();

    // Start a connect but never resolve it, then disconnect. The proxy is not
    // yet "connected", so disconnect takes the early-return branch.
    const pending = mgr.connectFromConfig('c1', baseConfig);
    void pending.catch(() => {});

    await mgr.disconnect('c1');

    expect(mgr.getHost('c1')).toBeUndefined();
  });
});
