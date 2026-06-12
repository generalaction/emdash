import { definePlugin, registerPluginBehavior } from '@emdash/shared/agents/plugins';
import { buildStandardCommand, copilotMcpAdapter } from '@emdash/shared/agents/plugins/helpers';
import { buildCopilotHookConfig } from './hooks';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    description:
      'GitHub Copilot CLI brings Copilot prompts to the terminal for code, shell, and search help.',
    websiteUrl: 'https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli',
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
      supportedEvents: ['stop', 'session', 'notification'],
    },
    hostDependency: {
      id: 'copilot',
      binaryNames: ['copilot'],
      installCommands: {
        macos: [
          {
            method: 'npm',
            command: 'npm install -g @github/copilot',
          },
        ],
        linux: [
          {
            method: 'npm',
            command: 'npm install -g @github/copilot',
          },
        ],
        windows: [
          {
            method: 'npm',
            command: 'npm install -g @github/copilot',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: {
          kind: 'npm',
          package: '@github/copilot',
        },
        update: {
          kind: 'package-manager',
        },
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
      flag: '-i',
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
        autoApproveFlag: '--allow-all-tools',
        initialPromptFlag: '-i',
        resumeFlag: '--resume',
        sessionIdFlag: '--resume',
        sessionIdOnResumeOnly: true,
      }),
  },
  hooks: buildCopilotHookConfig(),
  mcp: copilotMcpAdapter(),
});
