import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createScope } from '@emdash/shared/concurrency';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EnvSource, ExecContextOptions, IExecutionContext } from '#primitives/exec/api';
import type { HostDependencyResolver, Platform } from '#primitives/host-dependencies/api';
import type { PluginFs } from '#primitives/plugin-fs/api';
import type { IAcpBehavior } from '#services/agent-plugins/api/plugins/capabilities/acp';
import type {
  AgentAuthContext,
  IAgentAuthBehavior,
} from '#services/agent-plugins/api/plugins/capabilities/auth';
import type { CanonicalHookEvent } from '#services/agent-plugins/api/plugins/capabilities/hooks';
import type { McpServerRegistration } from '#services/agent-plugins/api/plugins/capabilities/mcp';
import type {
  AgentCommand,
  CommandContext,
} from '#services/agent-plugins/api/plugins/capabilities/prompt';
import { envConfigRoot } from './helpers/config-root';
import { AgentPluginHost, createPluginRegistry, type CLIAgentPluginProvider } from './index';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'emdash-plugin-host-'));
  tempDirs.push(dir);
  return dir;
}

describe('AgentPluginHost', () => {
  it('resolves supported ACP providers', () => {
    const acpBehavior = {} as IAcpBehavior;
    const host = createHost([
      plugin({
        acp: { kind: 'supported' },
        behavior: { acp: acpBehavior },
      }),
    ]);

    expect(host.resolveAcp('test')).toEqual({ behavior: acpBehavior });
  });

  it('returns null when a provider does not support ACP', () => {
    const host = createHost([plugin()]);

    expect(host.resolveAcp('test')).toBeNull();
  });

  it('resolves auth providers with metadata and behavior', () => {
    const authBehavior: IAgentAuthBehavior = {
      checkStatus: async () => ({ kind: 'unknown' }),
    };
    const host = createHost([
      plugin({
        auth: {
          kind: 'supported',
          methods: [
            {
              kind: 'api-key',
              id: 'api-key',
              name: 'API Key',
              envVars: [{ name: 'TEST_API_KEY', label: 'API key' }],
            },
          ],
        },
        behavior: { auth: authBehavior },
      }),
    ]);

    expect(host.resolveAuthProvider('test')).toEqual({
      name: 'Test Agent',
      auth: {
        kind: 'supported',
        methods: [
          {
            kind: 'api-key',
            id: 'api-key',
            name: 'API Key',
            envVars: [{ name: 'TEST_API_KEY', label: 'API key' }],
          },
        ],
      },
      behavior: authBehavior,
    });
  });

  it('resolves TUI providers with prompt and hook behavior', () => {
    const buildCommand = (_ctx: CommandContext): AgentCommand => ({
      command: 'test',
      args: [],
      env: {},
    });
    const parseHookEvent = (): CanonicalHookEvent => ({ kind: 'ignore' });
    const host = createHost([
      plugin({
        prompt: { kind: 'pty-only' },
        hooks: { kind: 'config', scope: 'workspace', supportedEvents: ['start'] },
        behavior: {
          prompt: { buildCommand },
          hooks: {
            resolveConfigRoots: ({ homeDir }) => [`${homeDir}/.test`],
            readHooks: async () => [],
            writeHooks: async () => [],
            deleteHooks: async () => {},
            getHooksInstalled: async () => false,
            parseHookEvent,
          },
        },
      }),
    ]);

    expect(host.resolveTuiProvider('test')).toEqual({
      name: 'Test Agent',
      prompt: { kind: 'pty-only' },
      hooks: { kind: 'config', scope: 'workspace', supportedEvents: ['start'] },
      buildCommand,
      parseHookEvent,
    });
  });

  it('returns null when a provider has no TUI prompt behavior', () => {
    const host = createHost([plugin()]);

    expect(host.resolveTuiProvider('test')).toBeNull();
  });

  it('builds prompt commands with resolved cli and allowlisted env', async () => {
    const buildCommand = vi.fn(
      (ctx: CommandContext): AgentCommand => ({
        command: ctx.cli,
        args: [ctx.model],
        env: { COMMAND_ENV: '1' },
      })
    );
    const host = createHost(
      [
        plugin({
          behavior: { prompt: { buildCommand } },
        }),
      ],
      async () => ({
        HOME: '/home/test',
        PATH: '/bin',
        XDG_CACHE_HOME: '/home/test/.cache',
        XDG_CONFIG_HOME: '/home/test/.config',
        XDG_DATA_HOME: '/home/test/.local/share',
        XDG_STATE_HOME: '/home/test/.local/state',
      })
    );

    const result = await host.buildPromptCommand('test', {
      autoApprove: false,
      model: 'sonnet',
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        command: 'test',
        args: ['sonnet'],
        env: expect.objectContaining({
          HOME: '/home/test',
          PATH: '/bin',
          COMMAND_ENV: '1',
          XDG_CACHE_HOME: '/home/test/.cache',
          XDG_CONFIG_HOME: '/home/test/.config',
          XDG_DATA_HOME: '/home/test/.local/share',
          XDG_STATE_HOME: '/home/test/.local/state',
        }),
      },
    });
  });

  it('builds ACP spawn with allowlisted env merged under caller env', async () => {
    const buildSpawn = vi.fn(({ cwd, cli }: { cwd: string; cli: string }) => ({
      command: cli,
      args: [],
      cwd,
      env: { SPAWN_ENV: 'base', ANTHROPIC_API_KEY: 'plugin-default' },
    }));
    const host = createHost([
      plugin({
        acp: { kind: 'supported' },
        behavior: { acp: { buildSpawn } as unknown as IAcpBehavior },
      }),
    ]);

    const result = await host.buildAcpSpawn('test', {
      cwd: '/work',
      env: { ANTHROPIC_API_KEY: 'user-key', ANTHROPIC_BASE_URL: 'https://proxy' },
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        cwd: '/work',
        env: expect.objectContaining({
          HOME: '/home/test',
          PATH: '/bin',
          SPAWN_ENV: 'base',
          ANTHROPIC_BASE_URL: 'https://proxy',
          // caller (user settings) env wins over allowlist and plugin defaults
          ANTHROPIC_API_KEY: 'user-key',
        }),
      },
    });
  });

  it('merges Windows ACP environment layers case-insensitively', async () => {
    const buildSpawn = vi.fn(({ cwd, cli }: { cwd: string; cli: string }) => ({
      command: cli,
      args: [],
      cwd,
      env: { Path: 'C:\\plugin' },
    }));
    const host = createHost(
      [
        plugin({
          acp: { kind: 'supported' },
          behavior: { acp: { buildSpawn } as unknown as IAcpBehavior },
        }),
      ],
      async () => ({ PATH: 'C:\\base' }),
      { platform: 'windows' }
    );

    const result = await host.buildAcpSpawn('test', {
      cwd: 'C:\\work',
      env: { pAtH: 'C:\\caller' },
    });

    expect(result).toMatchObject({ success: true, data: { env: { PATH: 'C:\\caller' } } });
    if (!result.success) throw new Error('Expected ACP spawn to resolve');
    expect(Object.keys(result.data.env).filter((key) => key.toLowerCase() === 'path')).toEqual([
      'PATH',
    ]);
  });

  it('passes the OrcaRouter API key from the host environment to spawned agents', async () => {
    const buildSpawn = vi.fn(() => ({ command: 'test', args: [], cwd: '/work' }));
    const host = createHost(
      [
        plugin({
          acp: { kind: 'supported' },
          behavior: { acp: { buildSpawn } as unknown as IAcpBehavior },
        }),
      ],
      async () => ({
        HOME: '/home/test',
        PATH: '/bin',
        ORCAROUTER_API_KEY: 'sk-orca-test',
      })
    );

    const result = await host.buildAcpSpawn('test', {
      cwd: '/work',
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        env: expect.objectContaining({
          ORCAROUTER_API_KEY: 'sk-orca-test',
        }),
      },
    });
  });

  it('binds machine dependencies for auth status checks', async () => {
    const checkStatus = vi.fn(async () => ({ kind: 'authenticated' as const, account: 'ada' }));
    const host = createHost([
      plugin({
        auth: {
          kind: 'supported',
          methods: [
            {
              kind: 'api-key',
              id: 'api-key',
              name: 'API Key',
              envVars: [{ name: 'TEST_API_KEY', label: 'API key' }],
            },
          ],
        },
        behavior: { auth: { checkStatus } },
      }),
    ]);

    await expect(host.checkAuthStatus('test')).resolves.toEqual({
      success: true,
      data: { kind: 'authenticated', account: 'ada' },
    });
    expect(checkStatus).toHaveBeenCalledWith({
      cli: 'test',
      exec: expect.any(Function),
      fs: expect.any(Object),
      env: expect.objectContaining({
        HOME: '/home/test',
        PATH: '/bin',
      }),
    });
  });

  it('merges a caller-supplied env into auth status checks, winning over ambient env', async () => {
    const checkStatus = vi.fn(async (ctx: AgentAuthContext) => {
      expect(ctx.env.CLAUDE_CONFIG_DIR).toBe('/home/test/axoniq');
      expect(ctx.env.HOME).toBe('/home/test');
      return { kind: 'authenticated' as const };
    });
    const host = createHost([
      plugin({
        auth: {
          kind: 'supported',
          methods: [
            {
              kind: 'api-key',
              id: 'api-key',
              name: 'API Key',
              envVars: [{ name: 'TEST_API_KEY', label: 'API key' }],
            },
          ],
        },
        behavior: { auth: { checkStatus } },
      }),
    ]);

    await expect(
      host.checkAuthStatus('test', { CLAUDE_CONFIG_DIR: '/home/test/axoniq' })
    ).resolves.toEqual({ success: true, data: { kind: 'authenticated' } });
    expect(checkStatus).toHaveBeenCalledTimes(1);
  });

  it('does not coalesce concurrent auth status checks for the same provider with different envs', async () => {
    const checkStatus = vi.fn(async (ctx: AgentAuthContext) => ({
      kind: 'authenticated' as const,
      account: ctx.env.CLAUDE_CONFIG_DIR,
    }));
    const host = createHost([
      plugin({
        auth: {
          kind: 'supported',
          methods: [
            {
              kind: 'api-key',
              id: 'api-key',
              name: 'API Key',
              envVars: [{ name: 'TEST_API_KEY', label: 'API key' }],
            },
          ],
        },
        behavior: { auth: { checkStatus } },
      }),
    ]);

    const [resultA, resultB] = await Promise.all([
      host.checkAuthStatus('test', { CLAUDE_CONFIG_DIR: '/home/test/personal' }),
      host.checkAuthStatus('test', { CLAUDE_CONFIG_DIR: '/home/test/axoniq' }),
    ]);

    expect(checkStatus).toHaveBeenCalledTimes(2);
    expect(resultA).toEqual({
      success: true,
      data: { kind: 'authenticated', account: '/home/test/personal' },
    });
    expect(resultB).toEqual({
      success: true,
      data: { kind: 'authenticated', account: '/home/test/axoniq' },
    });
  });

  it('merges a caller-supplied env into the login command, winning over ambient env', async () => {
    const host = createHost([plugin()]);

    const result = await host.buildLoginCommand('test', 'cli-login', {
      CLAUDE_CONFIG_DIR: '/home/test/axoniq',
    });

    expect(result).toEqual({
      success: true,
      data: {
        command: 'test',
        args: [],
        env: expect.objectContaining({
          HOME: '/home/test',
          CLAUDE_CONFIG_DIR: '/home/test/axoniq',
        }),
      },
    });
  });

  it('runs auth subprocesses with the allowlisted environment', async () => {
    const hostPath = 'C:\\Tools';
    const sourceEnv = {
      Path: hostPath,
      USERPROFILE: 'C:\\Users\\ada',
      USERNAME: 'ada',
      UNSAFE_ENV: 'must-not-leak',
    };
    const execCommand = vi.fn(
      async (_command: string, _args: string[] = [], _options: ExecContextOptions = {}) => ({
        stdout: '',
        stderr: '',
      })
    );
    const exec = { ...fakeExec(), exec: execCommand } satisfies IExecutionContext;
    const checkStatus = vi.fn(async (ctx: AgentAuthContext) => {
      await ctx.exec('test', []);
      expect(ctx.env.PATH).toBe(hostPath);
      expect(ctx.env).not.toHaveProperty('UNSAFE_ENV');
      return { kind: 'authenticated' as const };
    });
    const host = createHost(
      [
        plugin({
          auth: {
            kind: 'supported',
            methods: [
              {
                kind: 'api-key',
                id: 'api-key',
                name: 'API Key',
                envVars: [{ name: 'TEST_API_KEY', label: 'API key' }],
              },
            ],
          },
          behavior: { auth: { checkStatus } },
        }),
      ],
      async () => sourceEnv,
      { exec, platform: 'windows' }
    );

    try {
      await expect(host.checkAuthStatus('test')).resolves.toEqual({
        success: true,
        data: { kind: 'authenticated' },
      });
      expect(execCommand).toHaveBeenCalledWith('test', [], {
        env: expect.objectContaining({ PATH: hostPath }),
      });
      const options = execCommand.mock.calls[0]?.[2];
      expect(options?.env).not.toHaveProperty('UNSAFE_ENV');
    } finally {
      await host.dispose();
    }
  });

  it('binds plugin fs for MCP server reads', async () => {
    const servers: McpServerRegistration[] = [{ name: 'server', command: 'node' }];
    const readServers = vi.fn(async () => servers);
    const host = createHost([
      plugin({
        mcp: { kind: 'supported', scope: 'global', supportedTransports: ['stdio'] },
        behavior: {
          mcp: {
            readServers,
            writeServers: async () => {},
            removeServer: async () => {},
          },
        },
      }),
    ]);

    await expect(host.readMcpServers('test')).resolves.toEqual({ success: true, data: servers });
    expect(readServers).toHaveBeenCalledWith(expect.any(Object));
  });

  it('resolves MCP config against a per-instance root when the behavior declares one', async () => {
    const homeDir = await makeTempDir();
    const overrideRoot = path.join(homeDir, 'axoniq');
    const writeServers = vi.fn(async (fs: PluginFs, servers: McpServerRegistration[]) => {
      await fs.write('.claude.json', JSON.stringify({ mcpServers: servers }));
    });
    const host = createHost(
      [
        plugin({
          mcp: { kind: 'supported', scope: 'global', supportedTransports: ['stdio'] },
          behavior: {
            mcp: {
              readServers: async () => [],
              writeServers,
              removeServer: async () => {},
              resolveConfigRoot: envConfigRoot('CLAUDE_CONFIG_DIR', ''),
            },
          },
        }),
      ],
      async () => ({ HOME: homeDir, PATH: '/bin' }),
      { homeDir }
    );

    // No env override: resolves to homeDir itself, same as the default root.
    await host.writeMcpServers('test', [{ name: 'default-server', command: 'x' }]);
    await expect(readFile(path.join(homeDir, '.claude.json'), 'utf8')).resolves.toContain(
      'default-server'
    );

    // Instance env override: resolves to that instance's own root instead.
    await host.writeMcpServers('test', [{ name: 'axoniq-server', command: 'x' }], {
      CLAUDE_CONFIG_DIR: overrideRoot,
    });
    await expect(readFile(path.join(overrideRoot, '.claude.json'), 'utf8')).resolves.toContain(
      'axoniq-server'
    );
    // The default-rooted file is untouched by the override write.
    await expect(readFile(path.join(homeDir, '.claude.json'), 'utf8')).resolves.toContain(
      'default-server'
    );
  });

  it('loads the current user environment for each agent spawn context', async () => {
    let env = { HOME: '/home/test', PATH: '/tools/old' };
    const host = createHost([plugin()], async () => env);

    const before = await host.resolveSpawnContext('test');
    env = { HOME: '/home/test', PATH: '/tools/new' };
    const after = await host.resolveSpawnContext('test');

    expect(before).toMatchObject({ success: true, data: { agentEnv: { PATH: '/tools/old' } } });
    expect(after).toMatchObject({ success: true, data: { agentEnv: { PATH: '/tools/new' } } });
  });
});

function createHost(
  plugins: CLIAgentPluginProvider[],
  env: EnvSource = async () => ({ HOME: '/home/test', PATH: '/bin', UNSAFE_ENV: 'nope' }),
  options: { exec?: IExecutionContext; platform?: Platform; homeDir?: string } = {}
): AgentPluginHost {
  const registry = createPluginRegistry<CLIAgentPluginProvider>();
  for (const item of plugins) registry.register(item);
  return new AgentPluginHost({
    scope: createScope({ label: 'test' }),
    registry,
    exec: options.exec ?? fakeExec(),
    dependencies: fakeDependencies(),
    fs: memoryFs(),
    env,
    homeDir: options.homeDir ?? '/home/test',
    platform: options.platform,
  });
}

function fakeDependencies(): HostDependencyResolver {
  return {
    resolve: async (id) => ({
      success: true,
      data: {
        id,
        command: id,
        path: id,
        realpath: id,
        source: { kind: 'auto' },
      },
    }),
  };
}

function plugin(
  overrides: {
    acp?: { kind: 'none' } | { kind: 'supported' };
    auth?:
      | { kind: 'none' }
      | {
          kind: 'supported';
          methods: [
            {
              kind: 'api-key';
              id: string;
              name: string;
              envVars: [{ name: string; label: string }];
            },
          ];
        };
    prompt?: CLIAgentPluginProvider['capabilities']['prompt'];
    hooks?: CLIAgentPluginProvider['capabilities']['hooks'];
    mcp?: CLIAgentPluginProvider['capabilities']['mcp'];
    behavior?: Partial<CLIAgentPluginProvider['behavior']>;
  } = {}
): CLIAgentPluginProvider {
  return {
    metadata: {
      id: 'test',
      name: 'Test Agent',
      description: 'Test agent',
      websiteUrl: 'https://example.com',
    },
    capabilities: {
      acp: overrides.acp ?? { kind: 'none' },
      auth: overrides.auth ?? { kind: 'none' },
      prompt: overrides.prompt ?? { kind: 'argv' },
      hooks: overrides.hooks ?? { kind: 'none' },
      mcp: overrides.mcp ?? { kind: 'none' },
      hostDependency: {
        binaryNames: ['test'],
        installCommands: {},
        updates: { kind: 'none' },
      },
    },
    behavior: overrides.behavior ?? {},
  } as unknown as CLIAgentPluginProvider;
}

function fakeExec(): IExecutionContext {
  return {
    supportsLocalSpawn: false,
    async exec() {
      throw new Error('missing');
    },
    async execStreaming() {
      return { exitCode: 0 };
    },
    dispose() {},
  };
}

function memoryFs() {
  return {
    async read() {
      return null;
    },
    async write() {},
    async delete() {},
    async exists() {
      return false;
    },
    async list() {
      return [];
    },
  };
}
