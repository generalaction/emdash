import { defineMetadata, defineProvider } from '../../core';
import { buildClaudeHookConfig, buildStandardCommand, passthroughMcpAdapter } from '../../helpers';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'claude',
  name: 'Claude Code',
  description:
    'CLI that uses Anthropic Claude for code edits, explanations, and structured refactors in the terminal.',
  websiteUrl: 'https://code.claude.com/docs/en/quickstart',
  capabilities: {
    install: {
      binaryNames: ['claude'],
      installCommands: {
        macos: { command: 'curl -fsSL https://claude.ai/install.sh | bash', method: 'curl' },
        linux: { command: 'curl -fsSL https://claude.ai/install.sh | bash', method: 'curl' },
      },
    },
    models: { kind: 'none' },
    effort: { kind: 'none' },
    promptDelivery: { kind: 'argv', flag: '' },
    sessions: { kind: 'resumable' },
    autoApprove: { kind: 'supported' },
    hooks: { kind: 'config', scope: 'workspace', supportedEvents: ['notification', 'stop'] },
    mcp: { kind: 'supported', scope: 'global', supportedTransports: ['stdio', 'http'] },
    plugin: { kind: 'none' },
  },
});

export const provider = defineProvider(metadata, {
  buildCommand: (ctx) =>
    buildStandardCommand(ctx, {
      autoApproveFlag: '--dangerously-skip-permissions',
      initialPromptFlag: '',
      resumeFlag: '--resume',
      sessionIdFlag: '--session-id',
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
  hooks: buildClaudeHookConfig(),
  mcp: passthroughMcpAdapter('.claude.json'),
});
