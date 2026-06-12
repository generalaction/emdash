import { definePlugin, registerPluginBehavior } from '@emdash/shared/agents/plugins';
import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'autohand',
    name: 'Autohand Code',
    description:
      'Terminal coding agent with auto-commit, dry-run previews, community skills, and headless automation modes.',
    websiteUrl: 'https://autohand.ai/code/',
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
      id: 'autohand',
      binaryNames: ['autohand'],
      installCommands: {
        macos: [
          {
            method: 'npm',
            command: 'npm install -g autohand-cli',
          },
        ],
        linux: [
          {
            method: 'npm',
            command: 'npm install -g autohand-cli',
          },
        ],
        windows: [
          {
            method: 'npm',
            command: 'npm install -g autohand-cli',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: {
          kind: 'npm',
          package: 'autohand-cli',
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
      flag: '-p',
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
        autoApproveFlag: '--unrestricted',
        initialPromptFlag: '-p',
      }),
  },
});
