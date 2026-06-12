import { defineMetadata, defineProvider } from '../../core';
import { buildStandardCommand } from '../../helpers';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'kilocode',
  name: 'Kilocode',
  description:
    'Kilo AI coding assistant with multiple modes, broad model support, and checkpoint-based workflows.',
  websiteUrl: 'https://kilo.ai/docs/cli',
  capabilities: {
    install: {
      binaryNames: ['kilo'],
      installCommands: {
        macos: [{ command: 'npm install -g @kilocode/cli', method: 'npm' }],
        linux: [{ command: 'npm install -g @kilocode/cli', method: 'npm' }],
        windows: [{ command: 'npm install -g @kilocode/cli', method: 'npm' }],
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
      releaseSource: { kind: 'npm', package: '@kilocode/cli' },
      update: { kind: 'package-manager' },
    },
  },
});

export const provider = defineProvider(metadata, {
  buildCommand: (ctx) =>
    buildStandardCommand(ctx, {
      autoApproveFlag: '--auto',
      initialPromptFlag: '',
      resumeFlag: '--continue',
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
});
