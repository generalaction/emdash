import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import { buildStandardCommand } from '@emdash/core/agents/plugins/helpers';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'goose',
    name: 'Goose',
    description: 'Goose CLI that routes tasks to tools and models for coding workflows.',
    websiteUrl: 'https://goose-docs.ai/docs/quickstart/',
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
      id: 'goose',
      binaryNames: ['goose'],
      installCommands: {
        macos: [
          {
            method: 'curl',
            command:
              'curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | bash',
          },
        ],
        linux: [
          {
            method: 'curl',
            command:
              'curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | bash',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: {
          kind: 'github',
          repo: 'aaif-goose/goose',
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
      flag: '-t',
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
        defaultArgs: ['run', '-s'],
        initialPromptFlag: '-t',
        resumeFlag: '--resume',
      }),
  },
});
