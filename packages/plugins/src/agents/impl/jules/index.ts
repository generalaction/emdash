import { definePlugin, registerPluginBehavior } from '@emdash/shared/agents/plugins';
import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'jules',
    name: 'Jules',
    description:
      "Google's Jules CLI for managing asynchronous remote coding sessions and a terminal dashboard.",
    websiteUrl: 'https://jules.google/docs/cli/reference/',
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
      id: 'jules',
      binaryNames: ['jules'],
      versionArgs: ['version'],
      installCommands: {
        macos: [
          {
            method: 'npm',
            command: 'npm install -g @google/jules',
          },
        ],
        linux: [
          {
            method: 'npm',
            command: 'npm install -g @google/jules',
          },
        ],
        windows: [
          {
            method: 'npm',
            command: 'npm install -g @google/jules',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: {
          kind: 'npm',
          package: '@google/jules',
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
      kind: 'stateless',
    },
  },
  { icon }
);

export const provider = registerPluginBehavior(plugin, {
  prompt: {
    buildCommand: (ctx) =>
      buildStandardCommand(ctx, {
        initialPromptFlag: '',
      }),
  },
});
