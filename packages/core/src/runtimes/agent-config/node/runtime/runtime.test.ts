import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import { noopLogger } from '@emdash/shared/logger';
import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '#primitives/mcp/api';
import type {
  AgentAuthContext,
  AgentAuthStatus,
  CLIAgentPluginProvider,
  McpServerRegistration,
  PluginFs,
} from '#services/agent-plugins/api/plugins';
import { AgentPluginHost, createPluginRegistry } from '#services/agent-plugins/api/plugins';
import {
  NodeExecutionContext,
  type ExecContextOptions,
  type IExecutionContext,
} from '#services/exec/api';
import { FakePtySpawner } from '#services/pty/testing';
import { AgentConfigRuntime } from './runtime';

class FakeExecutionContext implements IExecutionContext {
  readonly supportsLocalSpawn = true;
  readonly exec = vi.fn(
    async (command: string, args: string[] = [], _opts: ExecContextOptions = {}) => {
      if (command === 'which' && args[0] === 'fake-agent') {
        return { stdout: '/opt/fake-agent\n', stderr: '' };
      }
      if (command === 'which' && args[0] === '-a' && args[1] === 'fake-agent') {
        return { stdout: '/opt/fake-agent\n', stderr: '' };
      }
      if (command === 'realpath' && args[0]) {
        return { stdout: `${args[0]}\n`, stderr: '' };
      }
      return { stdout: '', stderr: '' };
    }
  );
  readonly execStreaming = vi.fn(
    async (
      _command: string,
      _args: string[],
      _onChunk: (chunk: string) => boolean,
      _opts: { signal?: AbortSignal } = {}
    ) => ({ exitCode: 0 })
  );
  readonly dispose = vi.fn();
}

// The auth runtime tears sessions down itself, so kill must not emit an exit.
function makePtySpawner(): FakePtySpawner {
  return new FakePtySpawner({ exitOnKill: false });
}

class MemoryPluginFs implements PluginFs {
  private readonly files = new Map<string, string>();

  async read(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async delete(path: string): Promise<void> {
    const prefix = `${path}/`;
    for (const key of [...this.files.keys()]) {
      if (key === path || key.startsWith(prefix)) this.files.delete(key);
    }
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async list(path: string): Promise<string[]> {
    const prefix = `${path}/`;
    const entries = new Set<string>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const entry = key.slice(prefix.length).split('/')[0];
      if (entry) entries.add(entry);
    }
    return [...entries].sort();
  }
}

describe('AgentConfigRuntime', () => {
  it('resolves auth spawn context from embedded dependency state and allowlisted env', async () => {
    const authCheckStatus = vi.fn(async (_ctx: AgentAuthContext) => ({
      kind: 'authenticated' as const,
    }));
    const { runtime } = makeRuntime({ authCheckStatus });

    const result = await runtime.refreshAuthStatus('claude');

    expect(result.success).toBe(true);
    expect(authCheckStatus).toHaveBeenCalledTimes(1);
    const ctx = authCheckStatus.mock.calls[0]?.[0];
    expect(ctx?.cli).toBe('/opt/fake-agent');
    expect(ctx?.env.ANTHROPIC_API_KEY).toBe('secret');
    expect(ctx?.env.UNSAFE_ENV).toBeUndefined();
    expect(ctx?.env.SHELL).toBe('/bin/zsh');
    await runtime.dispose();
  });

  it('saves and lists MCP servers through provider behavior', async () => {
    const { runtime } = makeRuntime();
    const server: McpServer = {
      name: 'filesystem',
      transport: 'stdio',
      command: 'fs-mcp',
      args: ['/tmp'],
      providers: ['claude'],
    };

    const saved = await runtime.saveMcpServer(server);
    const listed = await runtime.listMcpForAgent('claude');

    expect(saved.success).toBe(true);
    expect(listed).toEqual(ok([server]));
    await runtime.dispose();
  });

  it('removes MCP servers from a specific provider', async () => {
    const { runtime } = makeRuntime();
    const server: McpServer = {
      name: 'filesystem',
      transport: 'stdio',
      command: 'fs-mcp',
      providers: ['claude'],
    };

    await expect(runtime.saveMcpServer(server)).resolves.toEqual(ok(undefined));
    await expect(runtime.removeMcpForAgent('claude', 'filesystem')).resolves.toEqual(ok(undefined));
    await expect(runtime.listMcpForAgent('claude')).resolves.toEqual(ok([]));
    await runtime.dispose();
  });

  it('creates and removes local skills through plugin fs', async () => {
    const { runtime } = makeRuntime();

    const created = await runtime.createSkill({
      name: 'reviewer',
      description: 'Review code changes',
      content: 'Check the diff carefully.',
    });
    const removed = await runtime.removeSkill('reviewer');

    expect(created.success).toBe(true);
    if (created.success) {
      expect(created.data).toHaveLength(1);
      expect(created.data[0]?.installId).toBe('reviewer');
      expect(created.data[0]?.description).toBe('Review code changes');
    }
    expect(removed).toEqual(ok([]));
    await runtime.dispose();
  });

  it('starts login through a managed PTY and exposes output', async () => {
    const ptySpawner = makePtySpawner();
    const { runtime } = makeRuntime({ ptySpawner });

    const started = await runtime.startLogin('claude', 'login');

    expect(started).toEqual(ok(undefined));
    expect(ptySpawner.processes).toHaveLength(1);
    expect(ptySpawner.specs[0]).toMatchObject({
      command: '/opt/fake-agent',
      args: [],
      cwd: '/home/ada',
      cols: 120,
      rows: 30,
    });

    ptySpawner.processes[0]?.emitData('Open https://example.com/login\n');
    expect((await runtime.loginOutputLog('claude')?.snapshot())?.data.text).toBe(
      'Open https://example.com/login\n'
    );

    expect(runtime.sendLoginInput('claude', 'code\n')).toEqual(ok(undefined));
    expect(ptySpawner.processes[0]?.writes).toEqual(['code\n']);
    await runtime.dispose();
  });

  it('spawns the login PTY at client-provided dimensions', async () => {
    const ptySpawner = makePtySpawner();
    const { runtime } = makeRuntime({ ptySpawner });

    const started = await runtime.startLogin('claude', 'login', { cols: 137, rows: 41 });

    expect(started).toEqual(ok(undefined));
    expect(ptySpawner.specs[0]).toMatchObject({ cols: 137, rows: 41 });
    await runtime.dispose();
  });

  it('launches a Windows cmd login provider through cmd.exe', async () => {
    const ptySpawner = makePtySpawner();
    const providerPath = 'C:\\Program Files\\npm\\fake-agent.cmd';
    const { runtime } = makeRuntime({ ptySpawner, platform: 'win32', providerPath });

    const started = await runtime.startLogin('claude', 'login');

    expect(started).toEqual(ok(undefined));
    expect(ptySpawner.specs[0]).toMatchObject({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', expect.stringContaining(providerPath)],
      cwd: '/home/ada',
    });
    await runtime.dispose();
  });

  it('runs a Windows cmd authentication probe with the sanitized environment', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'emdash-auth-cmd-'));
    const cmdWrapper = path.join(dir, 'cmd-wrapper');
    const providerPath = path.join(dir, 'fake-agent.cmd');
    await writeFile(cmdWrapper, '#!/bin/sh\nprintf \'%s\\n\' "$@"\n', 'utf8');
    await chmod(cmdWrapper, 0o755);
    const sourceEnv = {
      Path: dir,
      PATHEXT: '.CMD',
      ComSpec: cmdWrapper,
      UNSAFE_ENV: 'must-not-leak',
    };
    const exec = new NodeExecutionContext({
      platform: 'win32',
      env: sourceEnv,
      fileExists: (candidate) => candidate === providerPath,
    });
    const authCheckStatus = vi.fn(async (ctx: AgentAuthContext) => {
      const result = await ctx.exec(ctx.cli, ['status', 'hello world']);
      expect(result.stdout).toContain('/d\n/s\n/c\n');
      expect(result.stdout).toContain('fake-agent.cmd');
      expect(result.stdout).toContain('hello world');
      expect(ctx.env).not.toHaveProperty('UNSAFE_ENV');
      return { kind: 'authenticated' as const };
    });
    const { runtime } = makeRuntime({
      authCheckStatus,
      exec,
      platform: 'win32',
      providerPath,
      sourceEnv,
    });

    await expect(runtime.refreshAuthStatus('claude')).resolves.toEqual(
      ok({ kind: 'authenticated' })
    );
    await runtime.dispose();
  });

  it('cancels login by releasing the managed PTY', async () => {
    const ptySpawner = makePtySpawner();
    const { runtime } = makeRuntime({ ptySpawner });
    await runtime.startLogin('claude', 'login');

    await expect(runtime.cancelLogin('claude')).resolves.toEqual(ok(undefined));

    expect(ptySpawner.processes[0]!.killCount).toBeGreaterThan(0);
    expect(runtime.loginOutputLog('claude')).toBeNull();
    expect(runtime.sendLoginInput('claude', 'code\n').success).toBe(false);
    await runtime.dispose();
  });

  it('restarts login for repeated starts on the same provider', async () => {
    const ptySpawner = makePtySpawner();
    const { runtime } = makeRuntime({ ptySpawner });

    await runtime.startLogin('claude', 'login');
    await runtime.startLogin('claude', 'login');

    expect(ptySpawner.processes).toHaveLength(2);
    expect(ptySpawner.processes[0]!.killCount).toBeGreaterThan(0);
    expect(ptySpawner.processes[1]!.killCount).toBe(0);
    await runtime.dispose();
  });

  it('ignores stale output and exit callbacks from a replaced login', async () => {
    const ptySpawner = makePtySpawner();
    const authCheckStatus = vi.fn(async () => ({ kind: 'unauthenticated' as const }));
    const { runtime } = makeRuntime({ authCheckStatus, ptySpawner });

    await runtime.startLogin('claude', 'login');
    const first = ptySpawner.processes[0];
    await runtime.startLogin('claude', 'login');
    const second = ptySpawner.processes[1];

    first?.emitData('Open https://example.com/old\n');
    expect((await runtime.loginOutputLog('claude')?.snapshot())?.data.text).toBe('');

    first?.emitExit({ exitCode: 0, signal: null });
    expect(second?.killCount).toBe(0);
    expect(runtime.sendLoginInput('claude', 'code\n')).toEqual(ok(undefined));
    expect(authCheckStatus).not.toHaveBeenCalled();

    second?.emitData('Open https://example.com/current\n');
    expect((await runtime.loginOutputLog('claude')?.snapshot())?.data.text).toBe(
      'Open https://example.com/current\n'
    );
    await runtime.dispose();
  });

  it('refreshes auth and releases login when the PTY exits', async () => {
    const ptySpawner = makePtySpawner();
    const authCheckStatus = vi.fn(async () => ({ kind: 'unauthenticated' as const }));
    const { runtime } = makeRuntime({ authCheckStatus, ptySpawner });
    await runtime.startLogin('claude', 'login');

    ptySpawner.processes[0]?.emitExit({ exitCode: 0, signal: null });

    await vi.waitFor(() => {
      expect(authCheckStatus).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(runtime.sendLoginInput('claude', 'code\n').success).toBe(false);
    });
    await runtime.dispose();
  });

  it('deduplicates concurrent auth status refreshes', async () => {
    let resolveProbe!: () => void;
    const probeGate = new Promise<void>((resolve) => {
      resolveProbe = resolve;
    });
    const authCheckStatus = vi.fn(async () => {
      await probeGate;
      return { kind: 'authenticated' as const };
    });
    const { runtime } = makeRuntime({ authCheckStatus });

    const first = runtime.refreshAuthStatus('claude');
    const second = runtime.refreshAuthStatus('claude');

    await vi.waitFor(() => {
      expect(authCheckStatus).toHaveBeenCalledTimes(1);
    });
    resolveProbe();
    await expect(Promise.all([first, second])).resolves.toEqual([
      ok({ kind: 'authenticated' }),
      ok({ kind: 'authenticated' }),
    ]);
    await runtime.dispose();
  });

  it('does not let stale auth probes overwrite newer status updates', async () => {
    let resolveProbe!: () => void;
    const probeGate = new Promise<void>((resolve) => {
      resolveProbe = resolve;
    });
    const authCheckStatus = vi.fn(async () => {
      await probeGate;
      return { kind: 'authenticated' as const };
    });
    const { runtime } = makeRuntime({ authCheckStatus });
    const statusSource = runtime.authStatusSource();

    const refresh = statusSource.getStatus('claude', { refresh: true });
    await vi.waitFor(() => {
      expect(authCheckStatus).toHaveBeenCalledTimes(1);
    });
    statusSource.markUnauthenticated('claude', 'expired');
    resolveProbe();

    await expect(refresh).resolves.toEqual({ kind: 'authenticated' });
    await expect(statusSource.getStatus('claude')).resolves.toEqual({
      kind: 'unauthenticated',
      message: 'expired',
    });
    await runtime.dispose();
  });
});

function makeRuntime(
  options: {
    authCheckStatus?: (ctx: AgentAuthContext) => Promise<AgentAuthStatus>;
    logger?: Logger;
    ptySpawner?: FakePtySpawner;
    platform?: NodeJS.Platform;
    providerPath?: string;
    exec?: IExecutionContext;
    sourceEnv?: Record<string, string>;
  } = {}
) {
  const exec = options.exec ?? new FakeExecutionContext();
  const fs = new MemoryPluginFs();
  const mcpServers: McpServerRegistration[] = [];
  const registry = createPluginRegistry<CLIAgentPluginProvider>();
  registry.register({
    metadata: {
      id: 'claude',
      name: 'Claude Code',
      description: 'Test provider',
      websiteUrl: 'https://example.com',
    },
    capabilities: {
      acp: { kind: 'none' },
      auth: {
        kind: 'supported',
        methods: [{ kind: 'cli-login', id: 'login', name: 'Login', args: [] }],
      },
      autoApprove: { kind: 'none' },
      effort: { kind: 'none' },
      hooks: { kind: 'none' },
      hostDependency: {
        binaryNames: ['fake-agent'],
        skipVersionProbe: true,
        installCommands: {},
        updates: { kind: 'none' },
      },
      mcp: { kind: 'supported', supportsHttp: true },
      models: { kind: 'none' },
      plugins: { kind: 'none' },
      prompt: { kind: 'none' },
      sessions: { kind: 'none' },
      trust: { kind: 'none' },
    },
    assets: {},
    validate: () => [],
    behavior: {
      auth: {
        checkStatus: options.authCheckStatus ?? vi.fn(async () => ({ kind: 'unknown' as const })),
      },
      mcp: {
        readServers: vi.fn(async () => [...mcpServers]),
        writeServers: vi.fn(async (_pluginFs, servers) => {
          mcpServers.splice(0, mcpServers.length, ...servers);
        }),
        removeServer: vi.fn(async (_pluginFs, name) => {
          const index = mcpServers.findIndex((server) => server.name === name);
          if (index >= 0) mcpServers.splice(index, 1);
        }),
      },
    },
  } as unknown as CLIAgentPluginProvider);
  const logger = options.logger ?? noopLogger;
  const scope = createScope({ label: 'test-agent-config', logger });
  const agentHost = new AgentPluginHost({
    scope,
    registry,
    exec,
    dependencies: {
      resolve: async (id) => ({
        success: true,
        data: {
          id,
          command: 'fake-agent',
          path: options.providerPath ?? '/opt/fake-agent',
          realpath: options.providerPath ?? '/opt/fake-agent',
          source: { kind: 'auto' },
        },
      }),
    },
    fs,
    env: async () =>
      options.sourceEnv ?? {
        PATH: options.platform === 'win32' ? 'C:\\Program Files\\npm' : '/bin',
        HOME: '/home/ada',
        USER: 'ada',
        SHELL: '/bin/zsh',
        ...(options.platform === 'win32' ? { ComSpec: 'C:\\Windows\\System32\\cmd.exe' } : {}),
        ANTHROPIC_API_KEY: 'secret',
        UNSAFE_ENV: 'nope',
      },
    homeDir: '/home/ada',
    platform: options.platform === 'win32' ? 'windows' : undefined,
  });

  return {
    exec,
    runtime: new AgentConfigRuntime({
      scope,
      agentHost,
      ptySpawner: options.ptySpawner ?? makePtySpawner(),
      logger,
      platform: options.platform,
    }),
  };
}
