import { definePlugin, registerPluginBehavior } from '@emdash/shared/agents/plugins';
import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'codebuff',
    name: 'Codebuff',
    description:
      'Codebuff is an AI coding agent for project-directory assistance and day-to-day development tasks.',
    websiteUrl: 'https://www.codebuff.com/docs/help/quick-start',
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
      id: 'codebuff',
      binaryNames: ['codebuff'],
      installCommands: {
        macos: [
          {
            method: 'npm',
            command: 'npm install -g codebuff',
          },
        ],
        linux: [
          {
            method: 'npm',
            command: 'npm install -g codebuff',
          },
        ],
        windows: [
          {
            method: 'npm',
            command: 'npm install -g codebuff',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: {
          kind: 'npm',
          package: 'codebuff',
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
