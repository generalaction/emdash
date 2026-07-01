/**
 * Unit tests for the ACP transport layer:
 *   - SshChannelHandle behavior (via LegacySshAcpProcessHost.spawn)
 *   - AcpProcessHostManager machine routing
 */

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { MachineRef } from '@main/core/runtime/types';

// ---------------------------------------------------------------------------
// Module mocks — must be hoisted before any imports that trigger side-effects.
// ---------------------------------------------------------------------------

vi.mock('@main/core/agents/plugin-registry', () => ({
  getPlugin: vi.fn().mockReturnValue({
    capabilities: { hostDependency: { binaryNames: ['agent'] } },
    behavior: {},
  }),
}));

vi.mock('@main/core/dependencies/host-dependency-store', () => ({
  hostDependencyStore: { get: vi.fn() },
}));

vi.mock('@main/core/conversations/impl/resolve-agent-executable', () => ({
  resolveAgentExecutable: vi.fn().mockResolvedValue('/usr/local/bin/agent'),
}));

vi.mock('@main/core/pty/pty-env', () => ({
  buildAgentEnv: vi.fn().mockReturnValue({}),
}));

vi.mock('@main/core/runtime/legacy/ssh-legacy-fs', () => ({
  SshFileSystem: function MockSshFileSystem() {
    return {
      read: vi.fn(),
      write: vi.fn(),
      mkdir: vi.fn(),
    };
  },
}));

vi.mock('@main/core/execution-context/ssh-execution-context', () => ({
  SshExecutionContext: vi.fn(),
  buildSshCommand: vi.fn().mockReturnValue('cd /tmp && /usr/local/bin/agent'),
}));

vi.mock('@main/utils/shellEscape', () => ({
  quoteShellArg: vi.fn((s: string) => `'${s}'`),
}));

vi.mock('@main/core/ssh/lifecycle/production-ssh-connection-manager', () => ({
  sshConnectionManager: {
    connect: vi.fn(),
  },
}));

vi.mock('@main/core/dependencies/dependency-managers', () => ({
  localDependencyManager: { get: vi.fn() },
}));

vi.mock('@main/core/execution-context/local-execution-context', () => ({
  LocalExecutionContext: function MockLocalExecutionContext() {},
}));

// ---------------------------------------------------------------------------
// Fake SSH channel for testing SshChannelHandle
// ---------------------------------------------------------------------------

/** Minimal fake of an ssh2 ClientChannel. */
class FakeSshChannel extends EventEmitter {
  readonly stderr = new PassThrough();

  close() {
    this.emit('close', 0, null);
  }

  emitClose(code: number | null, signal?: string) {
    this.emit('close', code, signal ?? null);
  }

  emitError(err: Error) {
    this.emit('error', err);
  }
}

function makeFakeProxy(channel: FakeSshChannel) {
  return {
    connectionId: 'conn-test',
    exec: vi.fn((_cmd: string, cb: (err: Error | null, ch: FakeSshChannel) => void) => {
      cb(null, channel);
    }),
    getRemoteShellProfile: vi.fn().mockResolvedValue({ shellInit: '', shellType: 'bash' }),
  };
}

// ---------------------------------------------------------------------------
// SshChannelHandle (via LegacySshAcpProcessHost.spawn)
// ---------------------------------------------------------------------------

describe('SshChannelHandle (via LegacySshAcpProcessHost.spawn)', () => {
  it('stdout is the channel itself', async () => {
    const channel = new FakeSshChannel();
    const { LegacySshAcpProcessHost } = await import('./legacy-ssh-acp-process-host');
    const host = new LegacySshAcpProcessHost(makeFakeProxy(channel) as never);
    const handle = await host.spawn({ command: '/bin/agent', args: [], env: {}, cwd: '/tmp' });
    expect(handle.stdout).toBeDefined();
  });

  it('stderr is the channel.stderr', async () => {
    const channel = new FakeSshChannel();
    const { LegacySshAcpProcessHost } = await import('./legacy-ssh-acp-process-host');
    const host = new LegacySshAcpProcessHost(makeFakeProxy(channel) as never);
    const handle = await host.spawn({ command: '/bin/agent', args: [], env: {}, cwd: '/tmp' });
    expect(handle.stderr).toBe(channel.stderr);
  });

  it('onExit fires with the close code', async () => {
    const channel = new FakeSshChannel();
    const { LegacySshAcpProcessHost } = await import('./legacy-ssh-acp-process-host');
    const host = new LegacySshAcpProcessHost(makeFakeProxy(channel) as never);
    const handle = await host.spawn({ command: '/bin/agent', args: [], env: {}, cwd: '/tmp' });

    const exitCodes: Array<number | null> = [];
    handle.onExit((code) => exitCodes.push(code));

    channel.emitClose(42);
    expect(exitCodes).toEqual([42]);
    expect(handle.exitCode).toBe(42);
  });

  it('onExit normalises null code from signal-kill', async () => {
    const channel = new FakeSshChannel();
    const { LegacySshAcpProcessHost } = await import('./legacy-ssh-acp-process-host');
    const host = new LegacySshAcpProcessHost(makeFakeProxy(channel) as never);
    const handle = await host.spawn({ command: '/bin/agent', args: [], env: {}, cwd: '/tmp' });

    const exitCodes: Array<number | null> = [];
    handle.onExit((code) => exitCodes.push(code));

    // Signal-kill typically emits (null, 'TERM').
    channel.emitClose(null, 'TERM');
    expect(exitCodes).toEqual([null]);
    expect(handle.exitCode).toBeNull();
  });

  it('onError fires when the channel emits an error', async () => {
    const channel = new FakeSshChannel();
    const { LegacySshAcpProcessHost } = await import('./legacy-ssh-acp-process-host');
    const host = new LegacySshAcpProcessHost(makeFakeProxy(channel) as never);
    const handle = await host.spawn({ command: '/bin/agent', args: [], env: {}, cwd: '/tmp' });

    const errors: Error[] = [];
    handle.onError((err) => errors.push(err));

    const boom = new Error('SSH connection reset');
    channel.emitError(boom);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe(boom);
  });

  it('kill calls channel.close()', async () => {
    const channel = new FakeSshChannel();
    const closeSpy = vi.spyOn(channel, 'close');
    const { LegacySshAcpProcessHost } = await import('./legacy-ssh-acp-process-host');
    const host = new LegacySshAcpProcessHost(makeFakeProxy(channel) as never);
    const handle = await host.spawn({ command: '/bin/agent', args: [], env: {}, cwd: '/tmp' });

    handle.kill();
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it('spawn rejects when exec callback delivers an error', async () => {
    const execError = new Error('exec failed');
    const proxy = {
      connectionId: 'conn-fail',
      exec: vi.fn((_cmd: string, cb: (err: Error | null, ch: unknown) => void) => {
        cb(execError, null as never);
      }),
      getRemoteShellProfile: vi.fn().mockResolvedValue({ shellInit: '', shellType: 'bash' }),
    };

    const { LegacySshAcpProcessHost } = await import('./legacy-ssh-acp-process-host');
    const host = new LegacySshAcpProcessHost(proxy as never);
    await expect(
      host.spawn({ command: '/bin/agent', args: [], env: {}, cwd: '/tmp' })
    ).rejects.toThrow('exec failed');
  });
});

// ---------------------------------------------------------------------------
// AcpProcessHostManager – machine routing
// ---------------------------------------------------------------------------

describe('AcpProcessHostManager – machine routing', () => {
  it('local MachineRef returns a LocalAcpProcessHost', async () => {
    const { LocalAcpProcessHost } = await import('./local-acp-process-host');
    const { acpProcessHostManager } = await import('./acp-process-host-manager');
    const host = await acpProcessHostManager.get({ kind: 'local' });
    expect(host).toBeInstanceOf(LocalAcpProcessHost);
  });

  it('the same local host is returned on every call', async () => {
    const { acpProcessHostManager } = await import('./acp-process-host-manager');
    const a = await acpProcessHostManager.get({ kind: 'local' });
    const b = await acpProcessHostManager.get({ kind: 'local' });
    expect(a).toBe(b);
  });

  it('SSH MachineRef calls sshConnectionManager.connect and returns LegacySshAcpProcessHost', async () => {
    const { sshConnectionManager } =
      await import('@main/core/ssh/lifecycle/production-ssh-connection-manager');
    vi.mocked(sshConnectionManager.connect).mockResolvedValue({ connectionId: 'conn-1' } as never);

    const { LegacySshAcpProcessHost } = await import('./legacy-ssh-acp-process-host');
    const { acpProcessHostManager } = await import('./acp-process-host-manager');
    const machine: MachineRef = { kind: 'ssh', connectionId: 'conn-1' };
    const host = await acpProcessHostManager.get(machine);
    expect(host).toBeInstanceOf(LegacySshAcpProcessHost);
    expect(sshConnectionManager.connect).toHaveBeenCalledWith('conn-1');
  });

  it('SSH hosts are cached per connectionId', async () => {
    const { sshConnectionManager } =
      await import('@main/core/ssh/lifecycle/production-ssh-connection-manager');
    vi.mocked(sshConnectionManager.connect).mockResolvedValue({ connectionId: 'conn-2' } as never);

    const { acpProcessHostManager } = await import('./acp-process-host-manager');
    const machine: MachineRef = { kind: 'ssh', connectionId: 'conn-2' };
    const first = await acpProcessHostManager.get(machine);
    const second = await acpProcessHostManager.get(machine);
    expect(first).toBe(second);
  });
});
