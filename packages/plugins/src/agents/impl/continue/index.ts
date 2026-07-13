import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import { buildStandardCommand, continueMcpAdapter } from '@emdash/core/agents/plugins/helpers';
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
    mcp: {
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio', 'http'],
    },
    prompt: {
      kind: 'argv',
      flag: '-p',
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
        initialPromptFlag: '-p',
        modelFlag: '--model',
        resumeFlag: '--resume',
      }),
  },
  mcp: continueMcpAdapter(),
});
