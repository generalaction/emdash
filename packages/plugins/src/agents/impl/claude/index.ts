import { createRequire } from 'node:module';
import { definePlugin, registerPluginBehavior } from '@emdash/shared/agents/plugins';
import {
  buildStandardCommand,
  homebrewOption,
  passthroughMcpAdapter,
} from '@emdash/shared/agents/plugins/helpers';
import { buildClaudeHookConfig } from './hooks';
import { icon } from './icon';

const require = createRequire(import.meta.url);

function resolveClaudeAcpEntry(): string {
  // Resolves to the installed @agentclientprotocol/claude-agent-acp CLI entry point.
  return require.resolve('@agentclientprotocol/claude-agent-acp/dist/index.js');
}

export const plugin = definePlugin(
  {
    id: 'claude',
    name: 'Claude Code',
    description:
      'CLI that uses Anthropic Claude for code edits, explanations, and structured refactors in the terminal.',
    websiteUrl: 'https://code.claude.com/docs/en/quickstart',
  },
  {
    acp: {
      kind: 'supported',
    },
    autoApprove: {
      kind: 'supported',
    },
    effort: {
      kind: 'none',
    },
    hooks: {
      kind: 'config',
      scope: 'workspace',
      supportedEvents: ['start', 'notification', 'stop'],
    },
    hostDependency: {
      id: 'claude',
      binaryNames: ['claude'],
      installCommands: {
        macos: [
          {
            method: 'curl',
            command: 'curl -fsSL https://claude.ai/install.sh | bash',
            uninstallCommand: 'claude uninstall',
            recommended: true,
          },
          homebrewOption({ formula: 'claude-code', cask: true }),
        ],
        linux: [
          {
            method: 'curl',
            command: 'curl -fsSL https://claude.ai/install.sh | bash',
            uninstallCommand: 'claude uninstall',
          },
        ],
        windows: [
          {
            method: 'curl',
            command:
              'curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd',
            uninstallCommand: 'claude uninstall',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: {
          kind: 'github',
          repo: 'anthropics/claude-code',
        },
        update: {
          kind: 'cli',
          args: ['install', 'latest'],
        },
      },
      uninstall: {
        kind: 'package-manager',
      },
    },
    mcp: {
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio', 'http'],
    },
    models: {
      kind: 'selectable',
      modelOptions: {
        default: {
          name: 'Default',
          description: 'Use the model configured in your Claude settings',
        },
        sonnet: {
          name: 'Claude Sonnet',
          description: 'Balanced performance and speed',
          modelFeatures: { intelligence: 4, speed: 4 },
        },
        opus: {
          name: 'Claude Opus',
          description: 'Most capable model for complex tasks',
          modelFeatures: { intelligence: 5, speed: 2 },
        },
        haiku: {
          name: 'Claude Haiku',
          description: 'Fast and compact model for simpler tasks',
          modelFeatures: { intelligence: 3, speed: 5 },
        },
      },
    },
    plugins: {
      kind: 'none',
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
  acp: {
    buildSpawn: (ctx) => ({
      command: process.execPath,
      args: [resolveClaudeAcpEntry()],
      // process.execPath is the Electron binary; ELECTRON_RUN_AS_NODE makes it
      // run the adapter as a plain Node script instead of booting a new app.
      env: { ...ctx.env, ELECTRON_RUN_AS_NODE: '1' },
    }),
  },
  prompt: {
    buildCommand: (ctx) =>
      buildStandardCommand(ctx, {
        autoApproveFlag: '--dangerously-skip-permissions',
        initialPromptFlag: '',
        resumeFlag: '--resume',
        sessionIdFlag: '--session-id',
      }),
  },
  hooks: buildClaudeHookConfig(),
  mcp: passthroughMcpAdapter('.claude.json'),
});
