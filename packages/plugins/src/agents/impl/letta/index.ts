import { definePlugin, registerPluginBehavior } from '@emdash/shared/agents/plugins';
import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'letta',
    name: 'Letta',
    description:
      'Memory-first coding agent CLI with persistent agents that learn across sessions and portable memory across models.',
    websiteUrl: 'https://docs.letta.com/letta-code/cli',
  },
  {
    autoApprove: {
      kind: 'supported',
    },
    effort: {
      kind: 'none',
    },
    hooks: {
      kind: 'none',
    },
    hostDependency: {
      id: 'letta',
      binaryNames: ['letta'],
      skipVersionProbe: true,
      installCommands: {
        macos: [
          {
            method: 'npm',
            command: 'npm install -g @letta-ai/letta-code',
          },
        ],
        linux: [
          {
            method: 'npm',
            command: 'npm install -g @letta-ai/letta-code',
          },
        ],
        windows: [
          {
            method: 'npm',
            command: 'npm install -g @letta-ai/letta-code',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: {
          kind: 'npm',
          package: '@letta-ai/letta-code',
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
      kind: 'keystroke',
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
        autoApproveFlag: '--yolo',
        newConversationFlag: '--new',
      }),
  },
});
