import { defineMetadata, defineProvider } from '../../core';
import { buildStandardCommand } from '../../helpers';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'cline',
  name: 'Cline',
  description:
    'Cline CLI runs coding agents directly in your terminal with multi-provider model support.',
  websiteUrl: 'https://docs.cline.bot/cline-cli/overview',
  capabilities: {
    install: {
      binaryNames: ['cline'],
      installCommands: {
        macos: { command: 'npm install -g cline', method: 'npm' },
        linux: { command: 'npm install -g cline', method: 'npm' },
        windows: { command: 'npm install -g cline', method: 'npm' },
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
      initialPromptFlag: '',
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
});
