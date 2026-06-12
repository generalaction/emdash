import { defineMetadata, defineProvider } from '../../core';
import { buildStandardCommand } from '../../helpers';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'autohand',
  name: 'Autohand Code',
  description:
    'Terminal coding agent with auto-commit, dry-run previews, community skills, and headless automation modes.',
  websiteUrl: 'https://autohand.ai/code/',
  capabilities: {
    install: {
      binaryNames: ['autohand'],
      installCommands: {
        macos: [{ command: 'npm install -g autohand-cli', method: 'npm' }],
        linux: [{ command: 'npm install -g autohand-cli', method: 'npm' }],
        windows: [{ command: 'npm install -g autohand-cli', method: 'npm' }],
      },
    },
    models: { kind: 'none' },
    effort: { kind: 'none' },
    promptDelivery: { kind: 'argv', flag: '-p' },
    sessions: { kind: 'stateless' },
    autoApprove: { kind: 'supported' },
    hooks: { kind: 'none' },
    mcp: { kind: 'none' },
    plugin: { kind: 'none' },
    updates: {
      kind: 'supported',
      releaseSource: { kind: 'npm', package: 'autohand-cli' },
      update: { kind: 'package-manager' },
    },
  },
});

export const provider = defineProvider(metadata, {
  buildCommand: (ctx) =>
    buildStandardCommand(ctx, {
      autoApproveFlag: '--unrestricted',
      initialPromptFlag: '-p',
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
});
