import { definePlugin, registerPluginBehavior } from '@emdash/shared/agents/plugins';
import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'charm',
    name: 'Charm',
    description: 'Charm Crush agent CLI providing terminal-first AI assistance for coding tasks.',
    websiteUrl: 'https://github.com/charmbracelet/crush',
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
      id: 'charm',
      binaryNames: ['crush'],
      installCommands: {
        macos: [
          {
            method: 'npm',
            command: 'npm install -g @charmland/crush',
          },
        ],
        linux: [
          {
            method: 'npm',
            command: 'npm install -g @charmland/crush',
          },
        ],
        windows: [
          {
            method: 'npm',
            command: 'npm install -g @charmland/crush',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: {
          kind: 'npm',
          package: '@charmland/crush',
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
        autoApproveFlag: '--yolo',
      }),
  },
});
