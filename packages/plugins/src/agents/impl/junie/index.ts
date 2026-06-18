import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import { buildStandardCommand } from '@emdash/core/agents/plugins/helpers';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'junie',
    name: 'Junie',
    description:
      'JetBrains agentic coding CLI for interactive terminal and headless project workflows.',
    websiteUrl: 'https://junie.jetbrains.com/docs/junie-cli.html',
  },
  {
    autoApprove: {
      kind: 'none',
    },
    effort: {
      kind: 'none',
    },
    hooks: {
      kind: 'none',
    },
    hostDependency: {
      id: 'junie',
      binaryNames: ['junie'],
      installCommands: {
        macos: [
          {
            method: 'curl',
            command: 'curl -fsSL https://junie.jetbrains.com/install.sh | bash',
          },
        ],
        linux: [
          {
            method: 'curl',
            command: 'curl -fsSL https://junie.jetbrains.com/install.sh | bash',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: {
          kind: 'none',
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
      flag: '--task',
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
        initialPromptFlag: '--task',
        sessionIdFlag: '--session-id',
      }),
  },
});
