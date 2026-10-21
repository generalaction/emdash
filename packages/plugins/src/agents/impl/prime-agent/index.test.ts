import type { CommandContext, PluginFs } from '@emdash/core/services/agent-plugins/api/plugins';
import { describe, expect, it } from 'vitest';
import { provider } from './index';

const baseContext: CommandContext = {
  cli: 'prime-agent',
  autoApprove: false,
  initialPrompt: undefined,
  sessionId: 'emdash-conversation-id',
  providerSessionId: undefined,
  isResuming: false,
  model: '',
};

function build(context: Partial<CommandContext> = {}) {
  return provider.behavior.prompt!.buildCommand({ ...baseContext, ...context });
}

function createMemoryFs(initial: Record<string, string> = {}): PluginFs & {
  files: Map<string, string>;
} {
  const files = new Map(Object.entries(initial));
  return {
    files,
    async read(path) {
      return files.get(path) ?? null;
    },
    async write(path, content) {
      files.set(path, content);
    },
    async delete(path) {
      files.delete(path);
    },
    async exists(path) {
      return files.has(path);
    },
    async list(path) {
      return [...files.keys()].filter((file) => file.startsWith(path));
    },
  };
}

describe('prime-agent provider', () => {
  it('declares native ACP, stdio and HTTP MCP, resumable sessions, and the official installer', () => {
    expect(provider.capabilities.acp.kind).toBe('supported');
    expect(provider.capabilities.mcp).toEqual({
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio', 'http'],
    });
    expect(provider.capabilities.sessions.kind).toBe('resumable');
    expect(provider.capabilities.hostDependency).toMatchObject({
      binaryNames: ['prime-agent'],
      updateCommand: { kind: 'self', args: ['update'] },
      installCommands: {
        macos: [
          {
            command: 'curl -fsSL https://app.primeintellect.ai/prime-agent/install.sh | sh',
          },
        ],
        linux: [
          {
            command: 'curl -fsSL https://app.primeintellect.ai/prime-agent/install.sh | sh',
          },
        ],
      },
    });
  });

  it('starts Prime Agent in its native ACP mode', () => {
    expect(
      provider.behavior.acp!.buildSpawn({
        cli: 'prime-agent',
        cwd: '/tmp/project',
        env: {},
      })
    ).toEqual({ command: 'prime-agent', args: ['--mode', 'acp'] });
  });

  it('passes a fresh prompt and optional model through Prime Agent argv', () => {
    expect(build({ initialPrompt: 'Fix the bug', model: 'anthropic/claude-sonnet-4-5' })).toEqual({
      command: 'prime-agent',
      args: ['--model', 'anthropic/claude-sonnet-4-5', 'Fix the bug'],
      env: {},
    });
  });

  it('resumes from Prime Agent’s captured session file without replaying the prompt', () => {
    expect(
      build({
        initialPrompt: 'Do not replay this',
        isResuming: true,
        providerSessionId: '/home/ada/.prime/agent/sessions/project/session.jsonl',
      })
    ).toEqual({
      command: 'prime-agent',
      args: ['--resume', '/home/ada/.prime/agent/sessions/project/session.jsonl'],
      env: {},
    });
  });

  it('installs notification hooks in the env-overridable Prime Agent directory', async () => {
    const resolveConfigRoot = provider.behavior.plugins!.resolveConfigRoot;
    expect(resolveConfigRoot({ env: {}, homeDir: '/home/ada', platform: 'linux' })).toBe(
      '/home/ada/.prime/agent'
    );
    expect(
      resolveConfigRoot({
        env: { PRIME_AGENT_CODING_AGENT_DIR: '.prime-custom' },
        homeDir: '/home/ada',
        platform: 'linux',
      })
    ).toBe('/home/ada/.prime-custom');

    const fs = createMemoryFs();
    expect(await provider.behavior.plugins!.installPlugin(fs, { kind: 'global' })).toEqual([
      'extensions/emdash-hook.ts',
    ]);
    const content = await fs.read('extensions/emdash-hook.ts');
    expect(content).toContain("pi.on('session_start'");
    expect(content).toContain("pi.on('agent_start'");
    expect(content).toContain("pi.on('agent_end'");
    expect(content).toContain("event.reason !== 'quit'");
    expect(content).toContain("notifyEmdash('session', { providerSessionId: sessionFile })");
  });

  it('writes Prime HTTP MCP config and preserves its skill-specific fields', async () => {
    const configPath = '.prime/agent/settings.json';
    const fs = createMemoryFs({
      [configPath]: JSON.stringify({
        theme: 'prime-dark',
        mcpServers: {
          docs: {
            type: 'http',
            url: 'https://old.example.com/mcp',
            oauth: true,
            bearerTokenEnvVar: 'DOCS_TOKEN',
            enabledTools: ['search'],
          },
        },
      }),
    });

    const read = await provider.behavior.mcp!.readServers(fs);
    expect(read).toEqual([
      {
        name: 'docs',
        type: 'http',
        transport: 'http',
        url: 'https://old.example.com/mcp',
        oauth: {},
        bearerTokenEnvVar: 'DOCS_TOKEN',
        enabledTools: ['search'],
      },
    ]);

    await provider.behavior.mcp!.writeServers(fs, [
      {
        name: 'docs',
        transport: 'http',
        type: 'http',
        url: 'https://new.example.com/mcp',
        headers: { 'X-Tenant': 'emdash' },
        oauth: {},
      },
    ]);

    expect(JSON.parse((await fs.read(configPath))!)).toEqual({
      theme: 'prime-dark',
      mcpServers: {
        docs: {
          type: 'http',
          url: 'https://new.example.com/mcp',
          oauth: true,
          bearerTokenEnvVar: 'DOCS_TOKEN',
          enabledTools: ['search'],
          headers: { 'X-Tenant': 'emdash' },
        },
      },
    });
  });

  it('round-trips Prime stdio MCP config', async () => {
    const configPath = '.prime/agent/settings.json';
    const fs = createMemoryFs({
      [configPath]: JSON.stringify({
        mcpServers: {
          local: {
            type: 'stdio',
            command: 'npx',
            args: ['-y', 'example-mcp'],
            env: { TOKEN: 'secret' },
            enabled: true,
          },
        },
      }),
    });

    expect(await provider.behavior.mcp!.readServers(fs)).toEqual([
      {
        name: 'local',
        type: 'stdio',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'example-mcp'],
        env: { TOKEN: 'secret' },
        enabled: true,
      },
    ]);

    await provider.behavior.mcp!.writeServers(fs, [
      {
        name: 'local',
        transport: 'stdio',
        command: 'pnpm',
        args: ['dlx', 'example-mcp'],
        env: { TOKEN: 'updated' },
      },
    ]);

    expect(JSON.parse((await fs.read(configPath))!)).toEqual({
      mcpServers: {
        local: {
          type: 'stdio',
          command: 'pnpm',
          args: ['dlx', 'example-mcp'],
          env: { TOKEN: 'updated' },
        },
      },
    });
  });

  it('maps canonical cwd and timeout fields to Prime stdio config', async () => {
    const configPath = '.prime/agent/settings.json';
    const fs = createMemoryFs();

    await provider.behavior.mcp!.writeServers(fs, [
      {
        name: 'local',
        transport: 'stdio',
        command: 'node',
        cwd: '/srv/mcp',
        timeout: 60_000,
      },
    ]);

    expect(JSON.parse((await fs.read(configPath))!)).toEqual({
      mcpServers: {
        local: {
          type: 'stdio',
          command: 'node',
          cwd: '/srv/mcp',
          callTimeoutMs: 60_000,
        },
      },
    });
    expect(await provider.behavior.mcp!.readServers(fs)).toEqual([
      {
        name: 'local',
        type: 'stdio',
        transport: 'stdio',
        command: 'node',
        cwd: '/srv/mcp',
        timeout: 60_000,
      },
    ]);
  });

  it('clears omitted canonical stdio fields while preserving Prime-only fields', async () => {
    const configPath = '.prime/agent/settings.json';
    const fs = createMemoryFs({
      [configPath]: JSON.stringify({
        mcpServers: {
          local: {
            type: 'stdio',
            command: 'node',
            cwd: '/old/workspace',
            timeout: 5_000,
            callTimeoutMs: 10_000,
            startupTimeoutMs: 30_000,
            enabledTools: ['search'],
          },
        },
      }),
    });

    await provider.behavior.mcp!.writeServers(fs, [
      {
        name: 'local',
        transport: 'stdio',
        command: 'pnpm',
      },
    ]);

    expect(JSON.parse((await fs.read(configPath))!)).toEqual({
      mcpServers: {
        local: {
          type: 'stdio',
          command: 'pnpm',
          startupTimeoutMs: 30_000,
          enabledTools: ['search'],
        },
      },
    });
  });

  it('clears OAuth when it is omitted from an existing HTTP server', async () => {
    const configPath = '.prime/agent/settings.json';
    const fs = createMemoryFs({
      [configPath]: JSON.stringify({
        mcpServers: {
          docs: {
            type: 'http',
            url: 'https://old.example.com/mcp',
            oauth: true,
            bearerTokenEnvVar: 'DOCS_TOKEN',
          },
        },
      }),
    });

    await provider.behavior.mcp!.writeServers(fs, [
      {
        name: 'docs',
        transport: 'http',
        type: 'http',
        url: 'https://new.example.com/mcp',
      },
    ]);

    expect(JSON.parse((await fs.read(configPath))!)).toEqual({
      mcpServers: {
        docs: {
          type: 'http',
          url: 'https://new.example.com/mcp',
          bearerTokenEnvVar: 'DOCS_TOKEN',
        },
      },
    });
  });
});
