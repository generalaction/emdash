import { defineMetadata, defineProvider } from '../../core';
import { buildStandardCommand } from '../../helpers';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'charm',
  name: 'Charm',
  description: 'Charm Crush agent CLI providing terminal-first AI assistance for coding tasks.',
  websiteUrl: 'https://github.com/charmbracelet/crush',
  capabilities: {
    install: {
      binaryNames: ['crush'],
      installCommands: {
        macos: { command: 'npm install -g @charmland/crush', method: 'npm' },
        linux: { command: 'npm install -g @charmland/crush', method: 'npm' },
        windows: { command: 'npm install -g @charmland/crush', method: 'npm' },
      },
    },
    models: { kind: 'none' },
    effort: { kind: 'none' },
    promptDelivery: { kind: 'argv', flag: '' },
    sessions: { kind: 'stateless' },
    autoApprove: { kind: 'supported' },
    hooks: { kind: 'none' },
    mcp: { kind: 'none' },
    plugin: { kind: 'none' },
  },
});

export const provider = defineProvider(metadata, {
  buildCommand: (ctx) =>
    buildStandardCommand(ctx, {
      autoApproveFlag: '--yolo',
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
});
