import { defineMetadata, defineProvider } from '../../core';
import { buildStandardCommand } from '../../helpers';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'hermes',
  name: 'Hermes Agent',
  description:
    'Nous Research terminal agent with interactive chat, model-provider routing, skills, and session workflows.',
  websiteUrl: 'https://hermes-agent.nousresearch.com/docs/',
  capabilities: {
    install: {
      binaryNames: ['hermes'],
      installCommands: {
        macos: {
          command: 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash',
          method: 'curl',
        },
        linux: {
          command: 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash',
          method: 'curl',
        },
      },
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
      // hermes: useKeystrokeInjection
      resumeFlag: '--continue',
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
});
