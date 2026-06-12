import { definePlugin, registerPluginBehavior } from '@emdash/shared/agents/plugins';
import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'commandcode',
    name: 'Command Code',
    description:
      'Command Code CLI for terminal-first coding sessions that learn project and personal coding taste.',
    websiteUrl: 'https://commandcode.ai/docs/reference/cli',
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
      id: 'commandcode',
      binaryNames: ['command-code'],
      installCommands: {
        macos: [
          {
            method: 'npm',
            command: 'npm install -g command-code@latest',
          },
        ],
        linux: [
          {
            method: 'npm',
            command: 'npm install -g command-code@latest',
          },
        ],
        windows: [
          {
            method: 'npm',
            command: 'npm install -g command-code@latest',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: {
          kind: 'npm',
          package: 'command-code',
        },
        update: {
          kind: 'package-manager',
        },
      },
    },
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
        defaultArgs: ['--trust', '--skip-onboarding'],
        autoApproveFlag: '--yolo',
        initialPromptFlag: '',
        resumeFlag: '--continue',
      }),
  },
});
