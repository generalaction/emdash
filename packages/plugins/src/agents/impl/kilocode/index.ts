import { definePlugin, registerPluginBehavior } from '@emdash/shared/agents/plugins';
import { buildStandardCommand, npmDependency } from '@emdash/shared/agents/plugins/helpers';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'kilocode',
    name: 'Kilocode',
    description:
      'Kilo AI coding assistant with multiple modes, broad model support, and checkpoint-based workflows.',
    websiteUrl: 'https://kilo.ai/docs/cli',
  },
  {
    acp: {
      kind: 'none',
    },
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
      id: 'kilocode',
      package: '@kilocode/cli',
      binaryNames: ['kilo'],
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
        autoApproveFlag: '--auto',
        initialPromptFlag: '',
        resumeFlag: '--continue',
      }),
  },
});
