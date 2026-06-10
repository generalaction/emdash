import { defineMetadata, defineProvider } from '../../core';
import { buildKiroHookConfig, buildStandardCommand } from '../../helpers';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'kiro',
  name: 'Kiro (AWS)',
  description:
    'Kiro CLI by AWS, focused on interactive terminal-first development assistance and workflow automation.',
  websiteUrl: 'https://kiro.dev/docs/cli/',
  capabilities: {
    install: {
      binaryNames: ['kiro-cli'],
      installCommands: {
        macos: { command: 'curl -fsSL https://cli.kiro.dev/install | bash', method: 'curl' },
        linux: { command: 'curl -fsSL https://cli.kiro.dev/install | bash', method: 'curl' },
      },
    },
    models: { kind: 'none' },
    effort: { kind: 'none' },
    promptDelivery: { kind: 'argv', flag: '' },
    sessions: { kind: 'resumable' },
    autoApprove: { kind: 'supported' },
    hooks: {
      kind: 'config',
      scope: 'workspace',
      supportedEvents: ['session', 'start', 'stop'],
    },
    mcp: { kind: 'none' },
    plugin: { kind: 'none' },
  },
});

export const provider = defineProvider(metadata, {
  buildCommand: (ctx) =>
    buildStandardCommand(ctx, {
      defaultArgs: ['chat', '--agent', 'emdash'],
      autoApproveFlag: '--trust-all-tools',
      initialPromptFlag: '',
      resumeFlag: '--resume-id',
      sessionIdFlag: '--resume-id',
      sessionIdOnResumeOnly: true,
      resumeWithoutSessionFlag: '--resume',
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
  hooks: buildKiroHookConfig(),
});
