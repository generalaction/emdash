import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import {
  buildStandardCommand,
  npmDependency,
  passthroughMcpAdapter,
} from '@emdash/core/agents/plugins/helpers';
import { createNativeAcpBehavior } from '../../helpers/acp-stdio';
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
    mcp: {
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio', 'http'],
    },
    models: {
      kind: 'selectable',
      modelOptions: {
        'prism-a': {
          name: 'Prism (Claude + Gemini)',
          description: 'Automatically routes between Claude and Gemini models.',
          modelFeatures: { intelligence: 5, speed: 4 },
        },
        'prism-b': {
          name: 'Prism (GPT + Kimi)',
          description: 'Automatically routes between GPT and Kimi models.',
          modelFeatures: { intelligence: 5, speed: 4 },
        },
        'opus4.8': {
          name: 'Claude Opus 4.8',
          description: 'Auggie model option for complex, multi-step agentic work.',
          modelFeatures: { intelligence: 5, speed: 2 },
        },
        'sonnet4.6': {
          name: 'Claude Sonnet 4.6',
          description: 'Auggie model option for everyday coding tasks.',
          modelFeatures: { intelligence: 4, speed: 4 },
        },
        'gemini-3.1-pro-preview': {
          name: 'Gemini 3.1 Pro',
          description: 'Auggie model option for complex tasks at a lower cost tier.',
          modelFeatures: { intelligence: 4, speed: 4 },
        },
        'gpt5.5': {
          name: 'GPT-5.5',
          description: 'Auggie model option for complex planning and implementation work.',
          modelFeatures: { intelligence: 5, speed: 3 },
        },
        'kimi-k2.7': {
          name: 'Kimi K2.7 Code',
          description: 'Auggie coding-focused model option with a lower cost tier.',
          modelFeatures: { intelligence: 4, speed: 4 },
        },
      },
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
  acp: createNativeAcpBehavior(() => ({
    args: ['--acp'],
    env: {
      AUGMENT_DISABLE_AUTO_UPDATE: '1',
    },
  })),
  prompt: {
    buildCommand: (ctx) =>
      buildStandardCommand(ctx, {
        defaultArgs: ['--allow-indexing'],
        initialPromptFlag: '',
        resumeFlag: '--resume',
        sessionIdFlag: '--resume',
        sessionIdOnResumeOnly: true,
        resumeWithoutSessionFlag: '--continue',
        modelFlag: '--model',
      }),
  },
  hooks: buildAuggieHookConfig(),
  mcp: passthroughMcpAdapter('.augment/settings.json'),
});
