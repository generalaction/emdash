import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import { buildStandardCommand, npmDependency } from '@emdash/core/agents/plugins/helpers';
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
    hostDependency: npmDependency({
      id: 'jules',
      package: '@google/jules',
      versionArgs: ['version'],
    }),
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
    // The prompt is delivered via keystroke injection into the `jules` TUI, not
    // as a CLI argument — `jules <text>` would be parsed as an unknown subcommand.
    buildCommand: (ctx) => buildStandardCommand(ctx, {}),
  },
});
