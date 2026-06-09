import { defineMetadata, defineProvider } from '../../core';
import { buildGrokHookConfig, buildStandardCommand } from '../../helpers';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'grok',
  name: 'Grok',
  description:
    "xAI's Grok CLI for terminal-first coding sessions with plans, subagents, and parallel work.",
  websiteUrl: 'https://x.ai/cli',
  capabilities: {
    install: {
      binaryNames: ['grok'],
      installCommands: {
        macos: { command: 'curl -fsSL https://x.ai/cli/install.sh | bash', method: 'curl' },
        linux: { command: 'curl -fsSL https://x.ai/cli/install.sh | bash', method: 'curl' },
      },
    },
    models: { kind: 'none' },
    effort: { kind: 'none' },
    promptDelivery: { kind: 'keystroke' },
    sessions: { kind: 'resumable' },
    autoApprove: { kind: 'supported' },
    hooks: {
      kind: 'config',
      scope: 'global',
      supportedEvents: ['notification', 'stop', 'session', 'start'],
    },
    mcp: { kind: 'none' },
    plugin: { kind: 'none' },
  },
});

export const provider = defineProvider(metadata, {
  buildCommand: (ctx) =>
    buildStandardCommand(ctx, {
      autoApproveFlag: '--always-approve',
      // grok: useKeystrokeInjection — no initialPromptFlag needed
      resumeFlag: '-r',
      sessionIdFlag: '-r',
      sessionIdOnResumeOnly: true,
      resumeWithoutSessionFlag: '-r',
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
  hooks: buildGrokHookConfig(),
});
