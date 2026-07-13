import { Readable, Writable } from 'node:stream';
import type { Agent } from '@agentclientprotocol/sdk';
import type { AcpClientFactory } from '@emdash/core/services/agent-plugins/api/plugins';
import { describe, expect, it, vi } from 'vitest';
import { pluginRegistry } from '../../registry';

describe('claude acp capability', () => {
  it('declares acp: { kind: supported }', () => {
    const claude = pluginRegistry.get('claude');
    expect(claude).toBeDefined();
    expect(claude!.capabilities.acp.kind).toBe('supported');
  });

  it('all non-ACP plugins default acp to { kind: none }', () => {
    const acpProviders = new Set([
      'auggie',
      'claude',
      'cline',
      'codex',
      'copilot',
      'cursor',
      'devin',
      'droid',
      'goose',
      'grok',
      'hermes',
      'junie',
      'kilocode',
      'kimi',
      'kiro',
      'mimocode',
      'mistral',
      'opencode',
      'qoder',
      'qwen',
    ]);
    for (const p of pluginRegistry.getAll()) {
      if (acpProviders.has(p.metadata.id)) continue;
      expect(p.capabilities.acp.kind).toBe('none');
    }
  });
});

describe('claude acp behavior', () => {
  const claude = () => pluginRegistry.get('claude')!;
  const acpBehavior = () => claude().behavior.acp!;

  it('behavior.acp is defined', () => {
    expect(acpBehavior()).toBeDefined();
  });

  describe('buildSpawn', () => {
    const spawnCtx = { cwd: '/home/user/worktrees/task-1', env: {}, cli: '/usr/local/bin/claude' };

    it('passes CLAUDE_CODE_EXECUTABLE from ctx.cli', () => {
      const result = acpBehavior().buildSpawn(spawnCtx);
      expect(result.env?.CLAUDE_CODE_EXECUTABLE).toBe('/usr/local/bin/claude');
    });

    it('sets ELECTRON_RUN_AS_NODE=1', () => {
      const result = acpBehavior().buildSpawn({ ...spawnCtx, cli: '/x/claude' });
      expect(result.env?.ELECTRON_RUN_AS_NODE).toBe('1');
    });

    it('uses process.execPath as command', () => {
      const result = acpBehavior().buildSpawn(spawnCtx);
      expect(result.command).toBe(process.execPath);
    });

    it('provides a non-empty args array pointing at the adapter entry', () => {
      const result = acpBehavior().buildSpawn(spawnCtx);
      expect(result.args.length).toBeGreaterThan(0);
      expect(result.args[0]).toContain('claude-agent-acp');
    });
  });

  describe('connect', () => {
    it('returns an object with prompt and newSession methods', () => {
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
});
