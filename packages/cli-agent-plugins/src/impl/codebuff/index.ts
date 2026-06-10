import { defineMetadata, defineProvider } from '../../core';
import { buildStandardCommand } from '../../helpers';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'codebuff',
  name: 'Codebuff',
  description:
    'Codebuff is an AI coding agent for project-directory assistance and day-to-day development tasks.',
  websiteUrl: 'https://www.codebuff.com/docs/help/quick-start',
  capabilities: {
    install: {
      binaryNames: ['codebuff'],
      installCommands: {
        macos: [{ command: 'npm install -g codebuff', method: 'npm' }],
        linux: [{ command: 'npm install -g codebuff', method: 'npm' }],
        windows: [{ command: 'npm install -g codebuff', method: 'npm' }],
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
    updates: {
      kind: 'supported',
      releaseSource: { kind: 'npm', package: 'codebuff' },
      update: { kind: 'package-manager' },
    },
  },
});

export const provider = defineProvider(metadata, {
  buildCommand: (ctx) =>
    buildStandardCommand(ctx, {
      initialPromptFlag: '',
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
});
