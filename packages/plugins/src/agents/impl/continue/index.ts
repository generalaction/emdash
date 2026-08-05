import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import { buildStandardCommand } from '@emdash/core/agents/plugins/helpers';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'continue',
    name: 'Continue',
    description:
      'Continue CLI is a modular coding agent with configurable models, rules, and MCP tool support.',
    websiteUrl: 'https://docs.continue.dev/guides/cli',
  },
  {
    skills: {
      kind: 'supported',
      locations: [{ relativeDir: '.continue/skills', isolation: 'provider' }],
    },
    autoApprove: {
      kind: 'supported',
    },
    hostDependency: {
      id: 'continue',
      binaryNames: ['cn'],
      installCommands: {
        macos: [
          {
            method: 'npm',
            command: 'npm i -g @continuedev/cli',
          },
        ],
        linux: [
          {
            method: 'npm',
            command: 'npm i -g @continuedev/cli',
          },
        ],
        windows: [
          {
            method: 'npm',
            command: 'npm i -g @continuedev/cli',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: {
          kind: 'npm',
          package: '@continuedev/cli',
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
        autoApproveFlag: '--auto',
        initialPromptFlag: '',
        resumeFlag: '--resume',
      }),
  },
});
