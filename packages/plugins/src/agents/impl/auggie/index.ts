import { defineMetadata, defineProvider } from '../../core';
import { buildStandardCommand } from '../../helpers';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'auggie',
  name: 'Auggie',
  description:
    'Augment Code CLI to run an agent against your repository for code changes and reviews.',
  websiteUrl: 'https://docs.augmentcode.com/cli/overview',
  capabilities: {
    install: {
      binaryNames: ['auggie'],
      installCommands: {
        macos: [{ command: 'npm install -g @augmentcode/auggie', method: 'npm' }],
        linux: [{ command: 'npm install -g @augmentcode/auggie', method: 'npm' }],
        windows: [{ command: 'npm install -g @augmentcode/auggie', method: 'npm' }],
      },
    },
    models: { kind: 'none' },
    effort: { kind: 'none' },
    promptDelivery: { kind: 'argv', flag: '' },
    sessions: { kind: 'resumable' },
    autoApprove: { kind: 'none' },
    hooks: { kind: 'none' },
    mcp: { kind: 'none' },
    plugin: { kind: 'none' },
    updates: {
      kind: 'supported',
      releaseSource: { kind: 'npm', package: '@augmentcode/auggie' },
      update: { kind: 'package-manager' },
    },
  },
});

export const provider = defineProvider(metadata, {
  buildCommand: (ctx) =>
    buildStandardCommand(ctx, {
      // --allow-indexing: suppress the indexing prompt so the initial prompt is passed cleanly
      defaultArgs: ['--allow-indexing'],
      initialPromptFlag: '',
      resumeFlag: '--continue',
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
});
