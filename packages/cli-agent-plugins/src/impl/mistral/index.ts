import { defineMetadata, defineProvider } from '../../core';
import { buildStandardCommand } from '../../helpers';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'mistral',
  name: 'Mistral Vibe',
  description:
    'Mistral AI terminal coding assistant with conversational codebase help, execution tools, and file operations.',
  websiteUrl: 'https://github.com/mistralai/mistral-vibe',
  capabilities: {
    install: {
      binaryNames: ['vibe'],
      installCommands: {
        macos: [{ command: 'curl -LsSf https://mistral.ai/vibe/install.sh | bash',
          method: 'curl', }],
        linux: [{ command: 'curl -LsSf https://mistral.ai/vibe/install.sh | bash',
          method: 'curl', }],
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
    updates: {
      kind: 'supported',
      releaseSource: { kind: 'github', repo: 'mistralai/mistral-vibe' },
      update: { kind: 'package-manager' },
    },
  },
});

export const provider = defineProvider(metadata, {
  buildCommand: (ctx) =>
    buildStandardCommand(ctx, {
      autoApproveFlag: '--agent auto-approve',
      initialPromptFlag: '',
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
});
