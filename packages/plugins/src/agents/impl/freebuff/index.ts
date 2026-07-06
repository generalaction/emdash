import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import { buildStandardCommand, npmDependency } from '@emdash/core/agents/plugins/helpers';
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
    hostDependency: npmDependency({ id: 'freebuff', package: 'freebuff' }),
    prompt: {
      // The freebuff CLI takes no prompt positional/flag (its only positional is
      // the `login` command); the initial prompt is typed into the interactive TUI.
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
    buildCommand: (ctx) => buildStandardCommand(ctx, {}),
  },
});
