import { definePlugin, registerPluginBehavior } from '@emdash/shared/agents/plugins';
import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'freebuff',
    name: 'Freebuff',
    description:
      'Freebuff is a standalone Codebuff package for project-directory assistance and day-to-day development tasks.',
    websiteUrl: 'https://freebuff.com',
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
      id: 'freebuff',
      binaryNames: ['freebuff'],
      installCommands: {
        macos: [
          {
            method: 'npm',
            command: 'npm install -g freebuff',
          },
        ],
        linux: [
          {
            method: 'npm',
            command: 'npm install -g freebuff',
          },
        ],
        windows: [
          {
            method: 'npm',
            command: 'npm install -g freebuff',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: {
          kind: 'npm',
          package: 'freebuff',
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
  prompt: {
    buildCommand: (ctx) =>
      buildStandardCommand(ctx, {
        initialPromptFlag: '',
      }),
  },
});
