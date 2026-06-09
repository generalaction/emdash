import { defineMetadata, defineProvider } from '../../core';
import { buildDevinHookConfig, buildStandardCommand } from '../../helpers';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'devin',
  name: 'Devin',
  description:
    "Cognition's Devin for Terminal agent for local, interactive coding sessions with Devin Cloud integration.",
  websiteUrl: 'https://docs.devin.ai/cli',
  capabilities: {
    install: {
      binaryNames: ['devin'],
      installCommands: {
        macos: { command: 'curl -fsSL https://cli.devin.ai/install.sh | bash', method: 'curl' },
        linux: { command: 'curl -fsSL https://cli.devin.ai/install.sh | bash', method: 'curl' },
      },
    },
    models: { kind: 'none' },
    effort: { kind: 'none' },
    promptDelivery: { kind: 'argv', flag: '--' },
    sessions: { kind: 'resumable' },
    autoApprove: { kind: 'supported' },
    hooks: {
      kind: 'config',
      scope: 'workspace',
      supportedEvents: ['stop', 'notification'],
    },
    mcp: { kind: 'none' },
    plugin: { kind: 'none' },
  },
});

export const provider = defineProvider(metadata, {
  buildCommand: (ctx) =>
    buildStandardCommand(ctx, {
      autoApproveFlag: '--permission-mode=bypass',
      initialPromptFlag: '--',
      resumeFlag: '--continue',
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
  hooks: buildDevinHookConfig(),
});
