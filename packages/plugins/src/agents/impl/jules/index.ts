import { definePlugin, registerPluginBehavior } from '@emdash/shared/agents/plugins';
import { buildStandardCommand, npmDependency } from '@emdash/shared/agents/plugins/helpers';
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
    acp: {
      kind: 'none',
    },
    autoApprove: {
      kind: 'none',
    },
    effort: {
      kind: 'none',
    },
    hooks: {
      kind: 'none',
    },
    hostDependency: npmDependency({
      id: 'jules',
      package: '@google/jules',
      versionArgs: ['version'],
    }),
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
