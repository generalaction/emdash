import { defineMetadata, defineProvider } from '../../core';
import { buildStandardCommand } from '../../helpers';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'jules',
  name: 'Jules',
  description:
    "Google's Jules CLI for managing asynchronous remote coding sessions and a terminal dashboard.",
  websiteUrl: 'https://jules.google/docs/cli/reference/',
  capabilities: {
    install: {
      binaryNames: ['jules'],
      installCommands: {
        macos: { command: 'npm install -g @google/jules', method: 'npm' },
        linux: { command: 'npm install -g @google/jules', method: 'npm' },
        windows: { command: 'npm install -g @google/jules', method: 'npm' },
      },
    },
    models: { kind: 'none' },
    effort: { kind: 'none' },
    promptDelivery: { kind: 'keystroke' },
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
      // jules: useKeystrokeInjection
      initialPromptFlag: '',
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['version'] }),
});
