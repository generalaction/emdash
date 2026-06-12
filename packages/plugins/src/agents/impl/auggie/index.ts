import { definePlugin, registerPluginBehavior } from '@emdash/shared/agents/plugins';
import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'auggie',
    name: 'Auggie',
    description:
      'Augment Code CLI to run an agent against your repository for code changes and reviews.',
    websiteUrl: 'https://docs.augmentcode.com/cli/overview',
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
      id: 'auggie',
      binaryNames: ['auggie'],
      installCommands: {
        macos: [
          {
            method: 'npm',
            command: 'npm install -g @augmentcode/auggie',
          },
        ],
        linux: [
          {
            method: 'npm',
            command: 'npm install -g @augmentcode/auggie',
          },
        ],
        windows: [
          {
            method: 'npm',
            command: 'npm install -g @augmentcode/auggie',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: {
          kind: 'npm',
          package: '@augmentcode/auggie',
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
      kind: 'resumable',
    },
  },
  { icon }
);

export const provider = registerPluginBehavior(plugin, {
  prompt: {
    buildCommand: (ctx) =>
      buildStandardCommand(ctx, {
        defaultArgs: ['--allow-indexing'],
        initialPromptFlag: '',
        resumeFlag: '--continue',
      }),
  },
});
