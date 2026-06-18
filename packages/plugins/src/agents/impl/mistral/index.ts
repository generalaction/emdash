import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import { buildStandardCommand } from '@emdash/core/agents/plugins/helpers';
import { buildMistralHookConfig } from './hooks';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'mistral',
    name: 'Mistral Vibe',
    description:
      'Mistral AI terminal coding assistant with conversational codebase help, execution tools, and file operations.',
    websiteUrl: 'https://github.com/mistralai/mistral-vibe',
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
      supportedEvents: ['notification', 'stop'],
    },
    hostDependency: {
      id: 'mistral',
      binaryNames: ['vibe'],
      installCommands: {
        macos: [
          {
            method: 'curl',
            command: 'curl -LsSf https://mistral.ai/vibe/install.sh | bash',
          },
        ],
        linux: [
          {
            method: 'curl',
            command: 'curl -LsSf https://mistral.ai/vibe/install.sh | bash',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: {
          kind: 'github',
          repo: 'mistralai/mistral-vibe',
        },
        update: {
          kind: 'package-manager',
        },
      },
    },
    mcp: {
      kind: 'none',
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
      kind: 'stateless',
    },
  },
  { icon }
);

export const provider = registerPluginBehavior(plugin, {
  hooks: buildMistralHookConfig(),
  prompt: {
    buildCommand: (ctx) =>
      buildStandardCommand(ctx, {
        autoApproveFlag: '--agent auto-approve',
        initialPromptFlag: '',
      }),
  },
});
