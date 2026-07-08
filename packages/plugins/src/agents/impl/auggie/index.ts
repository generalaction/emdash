import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import {
  buildStandardCommand,
  nativeAcpBehavior,
  npmDependency,
} from '@emdash/core/agents/plugins/helpers';
import { buildAuggieHookConfig } from './hooks';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'auggie',
    name: 'Auggie',
    description:
      'Augment Code CLI to run an agent against your repository for code changes and reviews.',
    websiteUrl: 'https://docs.augmentcode.com/cli/overview',
  },
  {
    acp: {
      kind: 'supported',
    },
    hooks: {
      kind: 'config',
      scope: 'workspace',
      supportedEvents: ['notification', 'stop', 'session', 'start'],
    },
    hostDependency: npmDependency({ id: 'auggie', package: '@augmentcode/auggie' }),
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
  acp: nativeAcpBehavior(['--acp']),
  prompt: {
    buildCommand: (ctx) =>
      buildStandardCommand(ctx, {
        defaultArgs: ['--allow-indexing'],
        initialPromptFlag: '',
        resumeFlag: '--resume',
        sessionIdFlag: '--resume',
        sessionIdOnResumeOnly: true,
        resumeWithoutSessionFlag: '--continue',
      }),
  },
  hooks: buildAuggieHookConfig(),
});
