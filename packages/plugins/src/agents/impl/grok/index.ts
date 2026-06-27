import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import { buildStandardCommand } from '@emdash/core/agents/plugins/helpers';
import { buildGrokHookConfig } from './hooks';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'grok',
    name: 'Grok',
    description:
      "xAI's Grok CLI for terminal-first coding sessions with plans, subagents, and parallel work.",
    websiteUrl: 'https://docs.x.ai/build/overview',
  },
  {
    autoApprove: {
      kind: 'supported',
    },
    hooks: {
      kind: 'config',
      scope: 'global',
      supportedEvents: ['notification', 'stop', 'session', 'start'],
    },
    hostDependency: {
      id: 'grok',
      binaryNames: ['grok'],
      installCommands: {
        macos: [
          {
            method: 'curl',
            command: 'curl -fsSL https://x.ai/cli/install.sh | bash',
            updateCommand: 'grok update',
            recommended: true,
          },
          {
            method: 'npm',
            command: 'npm install -g @xai-official/grok@latest',
            updateCommand: 'npm install -g @xai-official/grok@latest',
            uninstallCommand: 'npm uninstall -g @xai-official/grok',
          },
        ],
        linux: [
          {
            method: 'curl',
            command: 'curl -fsSL https://x.ai/cli/install.sh | bash',
            updateCommand: 'grok update',
            recommended: true,
          },
          {
            method: 'npm',
            command: 'npm install -g @xai-official/grok@latest',
            updateCommand: 'npm install -g @xai-official/grok@latest',
            uninstallCommand: 'npm uninstall -g @xai-official/grok',
          },
        ],
        windows: [
          {
            method: 'powershell',
            command:
              'powershell -ExecutionPolicy ByPass -c "irm https://x.ai/cli/install.ps1 | iex"',
            updateCommand: 'grok update',
            recommended: true,
          },
          {
            method: 'npm',
            command: 'npm install -g @xai-official/grok@latest',
            updateCommand: 'npm install -g @xai-official/grok@latest',
            uninstallCommand: 'npm uninstall -g @xai-official/grok',
          },
        ],
      },
      installDocs: 'https://docs.x.ai/build/overview',
      updates: {
        kind: 'supported',
        releaseSource: {
          kind: 'npm',
          package: '@xai-official/grok',
        },
        update: {
          kind: 'package-manager',
        },
      },
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
        autoApproveFlag: '--always-approve',
        initialPromptFlag: '',
        resumeFlag: '-r',
        sessionIdFlag: '-r',
        sessionIdOnResumeOnly: true,
        resumeWithoutSessionFlag: '-r',
        modelFlag: '-m',
      }),
  },
  hooks: buildGrokHookConfig(),
});
