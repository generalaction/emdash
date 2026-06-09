import { defineMetadata, defineProvider } from '../../core';
import { buildStandardCommand } from '../../helpers';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'rovo',
  name: 'Rovo Dev',
  description:
    'Atlassian Rovo Dev CLI integrates terminal assistance with Jira, Confluence, and Bitbucket workflows.',
  websiteUrl: 'https://support.atlassian.com/rovo/docs/install-and-run-rovo-dev-cli-on-your-device/',
  capabilities: {
    install: {
      binaryNames: ['rovodev', 'acli'],
      installCommands: {
        macos: { command: 'acli rovodev auth login', method: 'other' },
        linux: { command: 'acli rovodev auth login', method: 'other' },
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
