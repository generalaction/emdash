import type { CommandContext } from '@emdash/core/services/agent-plugins/api/plugins';
import {
  definePlugin,
  registerPluginBehavior,
} from '@emdash/core/services/agent-plugins/api/plugins';
import {
  buildStandardCommand,
  createFileDropPlugin,
  createMcpAdapter,
  envConfigRoot,
} from '@emdash/core/services/agent-plugins/api/plugins/helpers';
import { createNativeAcpBehavior } from '../../helpers/acp-stdio';
import { icon } from './icon';
import { PRIME_AGENT_EXTENSION_CONTENT } from './plugin-file';

const PRIME_AGENT_EXTENSION_PATH = 'extensions/emdash-hook.ts';

export const plugin = definePlugin(
  {
    id: 'prime-agent',
    name: 'Prime Agent',
    description:
      'Self-improving coding and research agent with persistent Python, recursive subagents, and native ACP.',
    websiteUrl: 'https://github.com/PrimeIntellect-ai/prime-agent',
  },
  {
    acp: {
      kind: 'supported',
    },
    hooks: {
      kind: 'plugin',
      scope: 'global',
      supportedEvents: ['session', 'start', 'stop'],
    },
    hostDependency: {
      id: 'prime-agent',
      binaryNames: ['prime-agent'],
      installCommands: {
        macos: [
          {
            method: 'curl',
            command: 'curl -fsSL https://app.primeintellect.ai/prime-agent/install.sh | sh',
            recommended: true,
          },
        ],
        linux: [
          {
            method: 'curl',
            command: 'curl -fsSL https://app.primeintellect.ai/prime-agent/install.sh | sh',
            recommended: true,
          },
        ],
      },
      installDocs: 'https://github.com/PrimeIntellect-ai/prime-agent#quick-start',
      updateCommand: {
        kind: 'self',
        args: ['update'],
      },
    },
    mcp: {
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio', 'http'],
    },
    plugins: {
      kind: 'file-drop',
      scope: 'global',
    },
    prompt: {
      kind: 'argv',
      flag: '',
    },
    sessions: {
      kind: 'resumable',
    },
  },
  { icon }
);

export const provider = registerPluginBehavior(plugin, {
  acp: createNativeAcpBehavior(() => ({
    args: ['--mode', 'acp'],
  })),
  prompt: {
    buildCommand: (ctx: CommandContext) =>
      buildStandardCommand(ctx, {
        initialPromptFlag: '',
        resumeFlag: '--resume',
        sessionIdFlag: '--resume',
        sessionIdOnResumeOnly: true,
        modelFlag: '--model',
      }),
  },
  mcp: createMcpAdapter({
    configPath: '.prime/agent/settings.json',
    format: 'json',
    serversKey: 'mcpServers',
    toNative(server, current) {
      const type =
        server.transport === 'http' ||
        server.type === 'http' ||
        (typeof server.url === 'string' && typeof server.command !== 'string')
          ? 'http'
          : 'stdio';
      const entry: Record<string, unknown> = { ...current, type };

      for (const key of [
        'url',
        'headers',
        'command',
        'args',
        'env',
        'enabled',
        'cwd',
        'timeout',
        'oauth',
        'callTimeoutMs',
      ]) {
        delete entry[key];
      }

      if (type === 'http') {
        if (server.url !== undefined) entry.url = server.url;
        if (server.headers !== undefined) entry.headers = server.headers;
        if (server.oauth !== undefined) entry.oauth = server.oauth !== false;
      } else {
        delete entry.bearerTokenEnvVar;
        if (server.command !== undefined) entry.command = server.command;
        if (server.args !== undefined) entry.args = server.args;
        if (server.env !== undefined) entry.env = server.env;
        if (server.cwd !== undefined) entry.cwd = server.cwd;
      }

      if (server.enabled !== undefined) entry.enabled = server.enabled;
      if (server.timeout !== undefined) entry.callTimeoutMs = server.timeout;
      for (const key of ['bearerTokenEnvVar', 'enabledTools', 'disabledTools']) {
        if (server[key] !== undefined) entry[key] = server[key];
      }

      return entry;
    },
    fromNative(name, raw) {
      const entry = { ...raw };
      const type =
        entry.type === 'http' ||
        (typeof entry.url === 'string' && typeof entry.command !== 'string')
          ? 'http'
          : 'stdio';
      if (entry.oauth === true) entry.oauth = {};
      if (typeof entry.callTimeoutMs === 'number') {
        entry.timeout = entry.callTimeoutMs;
        delete entry.callTimeoutMs;
      }
      return { name, ...entry, transport: type, type };
    },
  }),
  plugins: createFileDropPlugin({
    resolveConfigRoot: envConfigRoot('PRIME_AGENT_CODING_AGENT_DIR', '.prime/agent'),
    relativePath: PRIME_AGENT_EXTENSION_PATH,
    content: PRIME_AGENT_EXTENSION_CONTENT,
  }),
});
