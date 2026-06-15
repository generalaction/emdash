import { definePlugin, registerPluginBehavior } from '@emdash/shared/agents/plugins';
import { buildStandardCommand, npmDependency } from '@emdash/shared/agents/plugins/helpers';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'cline',
    name: 'Cline',
    description:
      'Cline CLI runs coding agents directly in your terminal with multi-provider model support.',
    websiteUrl: 'https://docs.cline.bot/cline-cli/overview',
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
    hostDependency: npmDependency({ id: 'cline', package: 'cline' }),
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
        initialPromptFlag: '',
      }),
  },
});
