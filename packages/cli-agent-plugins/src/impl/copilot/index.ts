import { defineMetadata, defineProvider } from '../../core';
import { buildCopilotHookConfig, buildStandardCommand, copilotMcpAdapter } from '../../helpers';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'copilot',
  name: 'GitHub Copilot',
  description:
    'GitHub Copilot CLI brings Copilot prompts to the terminal for code, shell, and search help.',
  websiteUrl: 'https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli',
  capabilities: {
    install: {
      binaryNames: ['copilot'],
      installCommands: {
        macos: [{ command: 'npm install -g @github/copilot', method: 'npm' }],
        linux: [{ command: 'npm install -g @github/copilot', method: 'npm' }],
        windows: [{ command: 'npm install -g @github/copilot', method: 'npm' }],
      },
    },
    models: { kind: 'none' },
    effort: { kind: 'none' },
    promptDelivery: { kind: 'argv', flag: '-i' },
    sessions: { kind: 'resumable' },
    autoApprove: { kind: 'supported' },
    hooks: {
      kind: 'config',
      scope: 'workspace',
      supportedEvents: ['stop', 'session', 'notification'],
    },
    mcp: { kind: 'supported', scope: 'global', supportedTransports: ['stdio', 'http'] },
    plugin: { kind: 'none' },
    updates: {
      kind: 'supported',
      releaseSource: { kind: 'npm', package: '@github/copilot' },
      update: { kind: 'package-manager' },
    },
  },
});

export const provider = defineProvider(metadata, {
  buildCommand: (ctx) =>
    buildStandardCommand(ctx, {
      autoApproveFlag: '--allow-all-tools',
      initialPromptFlag: '-i',
      resumeFlag: '--resume',
      sessionIdFlag: '--resume',
      sessionIdOnResumeOnly: true,
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
  hooks: buildCopilotHookConfig(),
  mcp: copilotMcpAdapter(),
});
