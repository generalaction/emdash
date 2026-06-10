import { defineMetadata, defineProvider } from '../../core';
import { buildStandardCommand } from '../../helpers';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'junie',
  name: 'Junie',
  description:
    'JetBrains agentic coding CLI for interactive terminal and headless project workflows.',
  websiteUrl: 'https://junie.jetbrains.com/docs/junie-cli.html',
  capabilities: {
    install: {
      binaryNames: ['junie'],
      installCommands: {
        macos: [{ command: 'curl -fsSL https://junie.jetbrains.com/install.sh | bash',
          method: 'curl', }],
        linux: [{ command: 'curl -fsSL https://junie.jetbrains.com/install.sh | bash',
          method: 'curl', }],
      },
    },
    models: { kind: 'none' },
    effort: { kind: 'none' },
    promptDelivery: { kind: 'argv', flag: '--task' },
    sessions: { kind: 'resumable' },
    autoApprove: { kind: 'none' },
    hooks: { kind: 'none' },
    mcp: { kind: 'none' },
    plugin: { kind: 'none' },
    updates: {
      kind: 'supported',
      releaseSource: { kind: 'none' },
      update: { kind: 'package-manager' },
    },
  },
});

export const provider = defineProvider(metadata, {
  buildCommand: (ctx) =>
    buildStandardCommand(ctx, {
      initialPromptFlag: '--task',
      sessionIdFlag: '--session-id',
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
});
