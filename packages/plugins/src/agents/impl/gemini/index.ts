import { definePlugin, registerPluginBehavior } from '@emdash/shared/agents/plugins';
import {
  buildStandardCommand,
  geminiMcpAdapter,
  npmDependency,
} from '@emdash/shared/agents/plugins/helpers';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'gemini',
    name: 'Gemini',
    description:
      'CLI that uses Google Gemini models to assist with coding, reasoning, and command-line tasks.',
    websiteUrl: 'https://github.com/google-gemini/gemini-cli',
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
    hostDependency: npmDependency({ id: 'gemini', package: '@google/gemini-cli' }),
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
      flag: '-i',
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
        autoApproveFlag: '--approval-mode=yolo --skip-trust',
        initialPromptFlag: '-i',
        resumeFlag: '--resume',
        extraEnv: ctx.autoApprove ? { GEMINI_CLI_TRUST_WORKSPACE: 'true' } : {},
      }),
  },
  mcp: geminiMcpAdapter(),
});
