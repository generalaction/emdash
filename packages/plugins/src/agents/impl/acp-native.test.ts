import { Readable, Writable } from 'node:stream';
import type { Agent } from '@agentclientprotocol/sdk';
import type { AcpClientFactory } from '@emdash/core/agents/plugins';
import { describe, expect, it, vi } from 'vitest';
import { pluginRegistry } from '../registry';

const nativeAcpProviders = [
  { id: 'auggie', args: ['--acp'] },
  { id: 'cline', args: ['--acp'] },
  { id: 'copilot', args: ['--acp'] },
  { id: 'cursor', args: ['acp'] },
  { id: 'devin', args: ['acp'] },
  { id: 'droid', args: ['exec', '--output-format', 'acp'] },
  { id: 'gemini', args: ['--acp'] },
  { id: 'goose', args: ['acp'] },
  { id: 'grok', args: ['agent', 'stdio'] },
  { id: 'junie', args: ['--acp=true'] },
  { id: 'kilocode', args: ['acp'] },
  { id: 'kimi', args: ['acp'] },
  { id: 'qoder', args: ['--acp'] },
  { id: 'qwen', args: ['--acp'] },
] as const;

describe.each(nativeAcpProviders)('$id native acp behavior', ({ id, args }) => {
  const provider = () => pluginRegistry.get(id)!;
  const acpBehavior = () => provider().behavior.acp!;

  it('declares acp: { kind: supported }', () => {
    expect(provider()).toBeDefined();
    expect(provider().capabilities.acp.kind).toBe('supported');
  });

  it('uses the resolved CLI command with native ACP args', () => {
    const result = acpBehavior().buildSpawn({
      cwd: '/home/user/worktrees/task-1',
      env: {},
      cli: '/usr/local/bin/agent',
    });

    expect(result.command).toBe('/usr/local/bin/agent');
    expect(result.args).toEqual(args);
    expect(result.env).toBeUndefined();
  });

  it('connects stdio as an ACP agent API', () => {
    const stdin = new Writable({ write: (_c, _e, cb) => cb() });
    const stdout = new Readable({ read: () => {} });

    const toClient: AcpClientFactory = () => ({
      requestPermission: vi.fn(),
      sessionUpdate: vi.fn(),
    });

    const agentApi = acpBehavior().connect({ stdin, stdout }, toClient);
    expect(typeof (agentApi as Agent).prompt).toBe('function');
    expect(typeof (agentApi as Agent).newSession).toBe('function');
    expect(typeof (agentApi as Agent).initialize).toBe('function');
  });
});
