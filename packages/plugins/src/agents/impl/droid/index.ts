import { defineMetadata, defineProvider } from '../../core';
import { buildDroidHookConfig, buildStandardCommand, droidMcpAdapter } from '../../helpers';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'droid',
  name: 'Droid',
  description: "Factory AI's agent CLI for running multi-step coding tasks from the terminal.",
  websiteUrl: 'https://docs.factory.ai/cli/getting-started/quickstart',
  capabilities: {
    install: {
      binaryNames: ['droid'],
      installCommands: {
        macos: [{ command: 'curl -fsSL https://app.factory.ai/cli | sh', method: 'curl' }],
        linux: [{ command: 'curl -fsSL https://app.factory.ai/cli | sh', method: 'curl' }],
      },
    },
    models: { kind: 'none' },
    effort: { kind: 'none' },
    promptDelivery: { kind: 'argv', flag: '' },
    sessions: { kind: 'resumable' },
    autoApprove: { kind: 'none' },
    hooks: {
      kind: 'config',
      scope: 'workspace',
      supportedEvents: ['notification', 'stop', 'session'],
    },
    mcp: { kind: 'supported', scope: 'global', supportedTransports: ['stdio', 'http'] },
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
      initialPromptFlag: '',
      resumeFlag: '--resume',
      sessionIdFlag: '--resume',
      sessionIdOnResumeOnly: true,
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
  hooks: buildDroidHookConfig(),
  mcp: droidMcpAdapter(),
});
