import { isOk } from '@emdash/shared';
import { noopLogger } from '@emdash/shared/logger';
import { describe, expect, it, vi } from 'vitest';
import { FakeAcpProcessHost, FakePtySpawner } from '../acp-test-support';
import { AcpAuthManager } from './auth-manager';

describe('AcpAuthManager', () => {
  it('starts a login PTY and streams output through loginOutput', async () => {
    const host = new FakeAcpProcessHost();
    const ptySpawner = new FakePtySpawner();
    const manager = new AcpAuthManager({
      host,
      ptySpawner,
      homeDir: '/home/test',
      env: { PATH: '/bin' },
      logger: noopLogger,
      resolveAuthProvider: () => ({
        name: 'Claude Code',
        auth: {
          kind: 'supported',
          methods: [{ kind: 'cli-login', id: 'login', name: 'Login', args: ['auth', 'login'] }],
        },
      }),
    });

    const result = await manager.startLogin('claude', 'login');
    ptySpawner.processes[0]!.emitData('Visit https://example.com/login.');

    expect(isOk(result)).toBe(true);
    expect(ptySpawner.specs[0]).toMatchObject({
      command: '/usr/local/bin/fake-agent',
      args: ['auth', 'login'],
      cwd: '/home/test',
      cols: 120,
      rows: 30,
    });
    expect(manager.loginOutput('claude')?.snapshot().data.text).toBe(
      'Visit https://example.com/login.'
    );
    expect(
      manager.host.get({ providerId: 'claude' })?.states.status.snapshot().data.login
    ).toMatchObject({
      methodId: 'login',
      pendingUrl: { url: 'https://example.com/login' },
    });
  });

  it('forwards login input and resize to the PTY', async () => {
    const ptySpawner = new FakePtySpawner();
    const manager = createManager(ptySpawner);

    await manager.startLogin('claude', 'login');
    manager.sendLoginInput('claude', 'abc');
    manager.resizeLogin('claude', 80, 24);

    expect(ptySpawner.processes[0]!.write).toHaveBeenCalledWith('abc');
    expect(ptySpawner.processes[0]!.resize).toHaveBeenCalledWith(80, 24);
  });

  it('clears a pending URL when it is marked handled', async () => {
    const ptySpawner = new FakePtySpawner();
    const manager = createManager(ptySpawner);

    await manager.startLogin('claude', 'login');
    ptySpawner.processes[0]!.emitData('Open https://example.com/auth');
    const urlId = manager.host.get({ providerId: 'claude' })!.states.status.snapshot().data.login!
      .pendingUrl!.id;
    manager.markUrlHandled('claude', urlId);

    expect(
      manager.host.get({ providerId: 'claude' })!.states.status.snapshot().data.login!.pendingUrl
    ).toBeNull();
  });

  it('refreshes auth status after login exit and clears login when authenticated', async () => {
    const ptySpawner = new FakePtySpawner();
    const checkStatus = vi.fn().mockResolvedValue({ kind: 'authenticated', account: 'me' });
    const manager = createManager(ptySpawner, checkStatus);

    await manager.startLogin('claude', 'login');
    ptySpawner.processes[0]!.emitExit({ exitCode: 0, signal: null });

    await vi.waitFor(() => {
      expect(manager.host.get({ providerId: 'claude' })?.states.status.snapshot().data).toEqual({
        status: { kind: 'authenticated', account: 'me' },
        login: null,
      });
    });
  });
});

function createManager(
  ptySpawner: FakePtySpawner,
  checkStatus = vi.fn().mockResolvedValue({ kind: 'unknown' })
): AcpAuthManager {
  return new AcpAuthManager({
    host: new FakeAcpProcessHost(),
    ptySpawner,
    homeDir: '/home/test',
    env: {},
    logger: noopLogger,
    resolveAuthProvider: () => ({
      name: 'Claude Code',
      auth: {
        kind: 'supported',
        methods: [{ kind: 'cli-login', id: 'login', name: 'Login', args: [] }],
      },
      behavior: { checkStatus },
    }),
  });
}
