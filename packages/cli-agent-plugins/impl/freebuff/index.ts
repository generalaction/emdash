import { defineMetadata, defineProvider } from '../../core';
import { buildStandardCommand } from '../../helpers';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'freebuff',
  name: 'Freebuff',
  description:
    'Freebuff is a standalone Codebuff package for project-directory assistance and day-to-day development tasks.',
  websiteUrl: 'https://freebuff.com',
  capabilities: {
    install: {
      binaryNames: ['freebuff'],
      installCommands: {
        macos: { command: 'npm install -g freebuff', method: 'npm' },
        linux: { command: 'npm install -g freebuff', method: 'npm' },
        windows: { command: 'npm install -g freebuff', method: 'npm' },
      },
    },
    models: { kind: 'none' },
    effort: { kind: 'none' },
    promptDelivery: { kind: 'argv', flag: '' },
    sessions: { kind: 'stateless' },
    autoApprove: { kind: 'none' },
    hooks: { kind: 'none' },
    mcp: { kind: 'none' },
    plugin: { kind: 'none' },
  },
});

export const provider = defineProvider(metadata, {
  buildCommand: (ctx) =>
    buildStandardCommand(ctx, {
      initialPromptFlag: '',
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
});
