import { defineMetadata, defineProvider } from '../../core';
import { buildStandardCommand } from '../../helpers';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'commandcode',
  name: 'Command Code',
  description:
    'Command Code CLI for terminal-first coding sessions that learn project and personal coding taste.',
  websiteUrl: 'https://commandcode.ai/docs/reference/cli',
  capabilities: {
    install: {
      binaryNames: ['command-code'],
      installCommands: {
        macos: [{ command: 'npm install -g command-code@latest', method: 'npm' }],
        linux: [{ command: 'npm install -g command-code@latest', method: 'npm' }],
        windows: [{ command: 'npm install -g command-code@latest', method: 'npm' }],
      },
    },
    models: { kind: 'none' },
    effort: { kind: 'none' },
    promptDelivery: { kind: 'argv', flag: '' },
    sessions: { kind: 'resumable' },
    autoApprove: { kind: 'supported' },
    hooks: { kind: 'none' },
    mcp: { kind: 'none' },
    plugin: { kind: 'none' },
    updates: {
      kind: 'supported',
      releaseSource: { kind: 'npm', package: 'command-code' },
      update: { kind: 'package-manager' },
    },
  },
});

export const provider = defineProvider(metadata, {
  buildCommand: (ctx) =>
    buildStandardCommand(ctx, {
      defaultArgs: ['--trust', '--skip-onboarding'],
      autoApproveFlag: '--yolo',
      initialPromptFlag: '',
      resumeFlag: '--continue',
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
});
