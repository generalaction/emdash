import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import { buildStandardCommand, npmDependency } from '@emdash/core/agents/plugins/helpers';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'zero',
    name: 'Zero',
    description:
      'Terminal coding agent with local sessions, multi-provider model support, MCP, skills, hooks, and headless exec workflows.',
    websiteUrl: 'https://zero.gitlawb.com/',
  },
  {
    hostDependency: npmDependency({ id: 'zero', package: '@gitlawb/zero' }),
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
    buildCommand: (ctx) => buildStandardCommand(ctx, {}),
  },
});
