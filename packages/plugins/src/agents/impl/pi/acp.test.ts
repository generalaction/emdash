import { Readable, Writable } from 'node:stream';
import type { Agent } from '@agentclientprotocol/sdk';
import type { AcpClientFactory } from '@emdash/core/agents/plugins';
import { describe, expect, it, vi } from 'vitest';
import { pluginRegistry } from '../../registry';

describe('pi acp capability', () => {
  it('declares acp: { kind: supported }', () => {
    const pi = pluginRegistry.get('pi');

    expect(pi).toBeDefined();
    expect(pi!.capabilities.acp.kind).toBe('supported');
  });
});

describe('pi acp behavior', () => {
  const pi = () => pluginRegistry.get('pi')!;
  const acpBehavior = () => pi().behavior.acp!;

  it('runs the bundled adapter against the resolved Pi executable', () => {
    const result = acpBehavior().buildSpawn({
      cwd: '/home/user/worktrees/task-1',
      env: {},
      cli: '/usr/local/bin/pi',
    });

    expect(result.command).toBe(process.execPath);
    expect(result.args).toHaveLength(1);
    expect(result.args[0]).toMatch(/pi-acp[/\\]dist[/\\]index\.js$/);
    expect(result.env).toEqual({
      ELECTRON_RUN_AS_NODE: '1',
      PI_ACP_PI_COMMAND: '/usr/local/bin/pi',
      PI_ACP_QUIET_STARTUP: 'true',
    });
  });

  it('connects the adapter stdio to an ACP client', () => {
    const stdin = new Writable({ write: (_chunk, _encoding, callback) => callback() });
    const stdout = new Readable({ read: () => {} });
    const toClient: AcpClientFactory = () => ({
      requestPermission: vi.fn(),
      sessionUpdate: vi.fn(),
    });

    const agentApi = acpBehavior().connect({ stdin, stdout }, toClient);

    expect(typeof (agentApi as Agent).initialize).toBe('function');
    expect(typeof (agentApi as Agent).newSession).toBe('function');
    expect(typeof (agentApi as Agent).prompt).toBe('function');
  });
});
