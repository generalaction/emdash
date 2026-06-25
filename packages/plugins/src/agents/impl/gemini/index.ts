import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import {
  buildStandardCommand,
  geminiMcpAdapter,
  npmDependency,
} from '@emdash/core/agents/plugins/helpers';
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
    autoApprove: {
      kind: 'supported',
    },
    hostDependency: npmDependency({ id: 'gemini', package: '@google/gemini-cli' }),
    mcp: {
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio', 'http'],
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
        deduplicateFlags: ['--approval-mode=yolo', '--skip-trust'],
      }),
  },
  mcp: geminiMcpAdapter(),
});
