import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import type { CommandContext } from '@emdash/core/agents/plugins';
import {
  buildStandardCommand,
  crushMcpAdapter,
  npmDependency,
} from '@emdash/core/agents/plugins/helpers';
import { icon } from './icon';

function buildCharmCommand(ctx: CommandContext) {
  return buildStandardCommand(ctx, {
    defaultArgs: ctx.initialPrompt && !ctx.isResuming ? ['run'] : undefined,
    initialPromptFlag: '',
    modelFlag: '--model',
    resumeFlag: '--session',
    sessionIdFlag: '--session',
    sessionIdOnResumeOnly: true,
    resumeWithoutSessionFlag: '--continue',
  });
}

export const plugin = definePlugin(
  {
    id: 'charm',
    name: 'Charm',
    description: 'Charm Crush agent CLI providing terminal-first AI assistance for coding tasks.',
    websiteUrl: 'https://github.com/charmbracelet/crush',
  },
  {
    autoApprove: {
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
      // Crush discovers models from the configured provider catalog, so a static
      // picker could advertise models unavailable in a user's configuration.
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
    buildCommand: buildCharmCommand,
  },
  mcp: crushMcpAdapter(),
});
