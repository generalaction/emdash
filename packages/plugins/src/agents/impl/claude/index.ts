import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import {
  buildStandardCommand,
  homebrewOption,
  passthroughMcpAdapter,
} from '@emdash/core/agents/plugins/helpers';
import { buildClaudeHookConfig } from './hooks';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'claude',
    name: 'Claude Code',
    description:
      'CLI that uses Anthropic Claude for code edits, explanations, and structured refactors in the terminal.',
    websiteUrl: 'https://code.claude.com/docs/en/quickstart',
  },
  {
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
            method: 'powershell',
            command: 'irm https://claude.ai/install.ps1 | iex',
            uninstallCommand: 'claude uninstall',
            recommended: true,
          },
          {
            method: 'winget',
            command: 'winget install Anthropic.ClaudeCode',
            uninstallCommand: 'winget uninstall Anthropic.ClaudeCode',
          },
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
      kind: 'none',
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
