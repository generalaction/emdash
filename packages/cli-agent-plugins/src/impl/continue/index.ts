import { defineMetadata, defineProvider } from '../../core';
import { buildStandardCommand } from '../../helpers';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'continue',
  name: 'Continue',
  description:
    'Continue CLI is a modular coding agent with configurable models, rules, and MCP tool support.',
  websiteUrl: 'https://docs.continue.dev/guides/cli',
  capabilities: {
    install: {
      binaryNames: ['cn'],
      installCommands: {
        macos: [{ command: 'npm i -g @continuedev/cli', method: 'npm' }],
        linux: [{ command: 'npm i -g @continuedev/cli', method: 'npm' }],
        windows: [{ command: 'npm i -g @continuedev/cli', method: 'npm' }],
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
      releaseSource: { kind: 'npm', package: '@continuedev/cli' },
      update: { kind: 'package-manager' },
    },
  },
});

export const provider = defineProvider(metadata, {
  buildCommand: (ctx) =>
    buildStandardCommand(ctx, {
      autoApproveFlag: '--auto',
      initialPromptFlag: '',
      resumeFlag: '--resume',
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
});
