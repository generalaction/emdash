import { defineMetadata, defineProvider } from '../../core';
import { buildStandardCommand } from '../../helpers';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'goose',
  name: 'Goose',
  description: 'Goose CLI that routes tasks to tools and models for coding workflows.',
  websiteUrl: 'https://goose-docs.ai/docs/quickstart/',
  capabilities: {
    install: {
      binaryNames: ['goose'],
      installCommands: {
        macos: {
          command:
            'curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | bash',
          method: 'curl',
        },
        linux: {
          command:
            'curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | bash',
          method: 'curl',
        },
      },
    },
    models: { kind: 'none' },
    effort: { kind: 'none' },
    promptDelivery: { kind: 'argv', flag: '-t' },
    sessions: { kind: 'resumable' },
    autoApprove: { kind: 'none' },
    hooks: { kind: 'none' },
    mcp: { kind: 'none' },
    plugin: { kind: 'none' },
  },
});

export const provider = defineProvider(metadata, {
  buildCommand: (ctx) =>
    buildStandardCommand(ctx, {
      // goose run -s enters interactive mode after the initial prompt
      defaultArgs: ['run', '-s'],
      initialPromptFlag: '-t',
      resumeFlag: '--resume',
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
});
