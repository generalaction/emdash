import { defineMetadata, defineProvider } from '../../core';
import { buildStandardCommand, createFileDropPlugin, opencodeMcpAdapter } from '../../helpers';
import { OPENCODE_PLUGIN_CONTENT } from './plugin-file';

const OPENCODE_PLUGIN_PATH = '.opencode/plugins/emdash-notifications.js';
const validateSessionId = (id: string) => id.startsWith('ses');

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'opencode',
  name: 'OpenCode',
  description:
    'OpenCode CLI that interfaces with models for code generation and edits from the shell.',
  websiteUrl: 'https://opencode.ai/docs/cli/',
  capabilities: {
    install: {
      binaryNames: ['opencode'],
      installCommands: {
        macos: { command: 'npm install -g opencode-ai', method: 'npm' },
        linux: { command: 'npm install -g opencode-ai', method: 'npm' },
        windows: { command: 'npm install -g opencode-ai', method: 'npm' },
      },
    },
    models: { kind: 'none' },
    effort: { kind: 'none' },
    promptDelivery: { kind: 'argv', flag: '--prompt' },
    sessions: { kind: 'resumable' },
    autoApprove: { kind: 'supported' },
    hooks: {
      kind: 'plugin',
      scope: 'workspace',
      supportedEvents: ['notification', 'stop', 'session'],
    },
    mcp: { kind: 'supported', scope: 'global', supportedTransports: ['stdio', 'http'] },
    plugin: { kind: 'file-drop', scope: 'workspace' },
  },
});

export const provider = defineProvider(metadata, {
  buildCommand: (ctx) =>
    buildStandardCommand(ctx, {
      // OpenCode uses env var for auto-approve, not a CLI flag
      extraEnv: ctx.autoApprove ? { OPENCODE_PERMISSION: '{"*":"allow"}' } : {},
      initialPromptFlag: '--prompt',
      resumeFlag: '--session',
      sessionIdFlag: '--session',
      sessionIdOnResumeOnly: true,
      resumeWithoutSessionFlag: '--continue',
      validateSessionId,
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
  validateSessionId,
  mcp: opencodeMcpAdapter(),
  plugin: createFileDropPlugin({
    relativePath: OPENCODE_PLUGIN_PATH,
    content: OPENCODE_PLUGIN_CONTENT,
  }),
});
