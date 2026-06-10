import { defineMetadata, defineProvider } from '../../core';
import { buildStandardCommand } from '../../helpers';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'letta',
  name: 'Letta',
  description:
    'Memory-first coding agent CLI with persistent agents that learn across sessions and portable memory across models.',
  websiteUrl: 'https://docs.letta.com/letta-code/cli',
  capabilities: {
    install: {
      binaryNames: ['letta'],
      installCommands: {
        macos: { command: 'npm install -g @letta-ai/letta-code', method: 'npm' },
        linux: { command: 'npm install -g @letta-ai/letta-code', method: 'npm' },
        windows: { command: 'npm install -g @letta-ai/letta-code', method: 'npm' },
      },
      // Letta does not support a --version flag
      skipVersionProbe: true,
    },
    models: { kind: 'none' },
    effort: { kind: 'none' },
    promptDelivery: { kind: 'keystroke' },
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
      autoApproveFlag: '--yolo',
      // letta: useKeystrokeInjection
      // Bare `letta` auto-resumes; --new starts a fresh conversation.
      newConversationFlag: '--new',
    }),
});
