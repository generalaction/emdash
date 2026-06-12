import { definePlugin, registerPluginBehavior } from '@emdash/shared/agents/plugins';
import { buildStandardCommand, geminiMcpAdapter } from '@emdash/shared/agents/plugins/helpers';
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
    effort: {
      kind: 'none',
    },
    hooks: {
      kind: 'none',
    },
    hostDependency: {
      id: 'gemini',
      binaryNames: ['gemini'],
      installCommands: {
        macos: [
          {
            method: 'npm',
            command: 'npm install -g @google/gemini-cli',
          },
        ],
        linux: [
          {
            method: 'npm',
            command: 'npm install -g @google/gemini-cli',
          },
        ],
        windows: [
          {
            method: 'npm',
            command: 'npm install -g @google/gemini-cli',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: {
          kind: 'npm',
          package: '@google/gemini-cli',
        },
        update: {
          kind: 'package-manager',
        },
      },
    },
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
