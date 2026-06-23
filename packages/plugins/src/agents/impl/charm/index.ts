import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import {
  buildStandardCommand,
  crushMcpAdapter,
  npmDependency,
} from '@emdash/core/agents/plugins/helpers';
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
    hostDependency: npmDependency({
      id: 'charm',
      package: '@charmland/crush',
      binaryNames: ['crush'],
    }),
    mcp: {
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio', 'http'],
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
        defaultArgs: ['run'],
        autoApproveFlag: '--yolo',
        initialPromptFlag: '',
        sessionIdFlag: '--session',
        sessionIdAlways: true,
      }),
  },
  mcp: crushMcpAdapter(),
});
