import { defineMetadata, defineProvider } from '../../core';
import { buildStandardCommand } from '../../helpers';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'antigravity',
  name: 'Antigravity',
  description:
    'Google Antigravity CLI for terminal-first agent sessions with shared Antigravity settings and conversation history.',
  websiteUrl: 'https://antigravity.google/docs/cli-overview',
  capabilities: {
    install: {
      binaryNames: ['agy', 'antigravity'],
      installCommands: {
        macos: {
          command: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
          method: 'curl',
        },
        linux: {
          command: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
          method: 'curl',
        },
      },
    },
    models: { kind: 'none' },
    effort: { kind: 'none' },
    promptDelivery: { kind: 'argv', flag: '-i' },
    sessions: { kind: 'resumable' },
    autoApprove: { kind: 'supported' },
    hooks: { kind: 'none' },
    mcp: { kind: 'none' },
    plugin: { kind: 'none' },
  },
});

export const provider = defineProvider(metadata, {
  buildCommand: (ctx) =>
    buildStandardCommand(ctx, {
      autoApproveFlag: '--dangerously-skip-permissions',
      initialPromptFlag: '-i',
      sessionIdFlag: '--conversation=',
      sessionIdAlways: true,
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
});
