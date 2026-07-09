import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import {
  buildStandardCommand,
  geminiMcpAdapter,
  npmDependency,
} from '@emdash/core/agents/plugins/helpers';
import { createNativeAcpBehavior } from '../../helpers/acp-stdio';
import { authenticatedFromEnv } from '../../helpers/auth';
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
      kind: 'supported',
    },
    autoApprove: {
      kind: 'supported',
    },
    auth: {
      kind: 'supported',
      methods: [
        {
          kind: 'cli-login',
          id: 'gemini-login',
          name: 'Sign in with Gemini',
          args: [],
          description: 'Open the Gemini CLI and complete the built-in sign-in flow.',
        },
        {
          kind: 'api-key',
          id: 'gemini-api-key',
          name: 'Use a Gemini API key',
          envVars: [
            { name: 'GEMINI_API_KEY', label: 'Gemini API key' },
            { name: 'GOOGLE_API_KEY', label: 'Google API key' },
          ],
          helpUrl: 'https://aistudio.google.com/app/apikey',
        },
      ],
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
  auth: {
    checkStatus: async (ctx) => authenticatedFromEnv(ctx, ['GEMINI_API_KEY', 'GOOGLE_API_KEY']),
  },
  acp: createNativeAcpBehavior(() => ({
    args: ['--acp'],
  })),
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
