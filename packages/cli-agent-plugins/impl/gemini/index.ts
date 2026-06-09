import { defineMetadata, defineProvider } from '../../core';
import { buildStandardCommand, geminiMcpAdapter } from '../../helpers';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'gemini',
  name: 'Gemini',
  description:
    'CLI that uses Google Gemini models to assist with coding, reasoning, and command-line tasks.',
  websiteUrl: 'https://github.com/google-gemini/gemini-cli',
  capabilities: {
    install: {
      binaryNames: ['gemini'],
      installCommands: {
        macos: { command: 'npm install -g @google/gemini-cli', method: 'npm' },
        linux: { command: 'npm install -g @google/gemini-cli', method: 'npm' },
        windows: { command: 'npm install -g @google/gemini-cli', method: 'npm' },
      },
    },
    models: { kind: 'none' },
    effort: { kind: 'none' },
    promptDelivery: { kind: 'argv', flag: '-i' },
    sessions: { kind: 'resumable' },
    autoApprove: { kind: 'supported' },
    hooks: { kind: 'none' },
    mcp: { kind: 'supported', scope: 'global', supportedTransports: ['stdio', 'http'] },
    plugin: { kind: 'none' },
  },
});

export const provider = defineProvider(metadata, {
  buildCommand: (ctx) =>
    buildStandardCommand(ctx, {
      autoApproveFlag: '--approval-mode=yolo --skip-trust',
      initialPromptFlag: '-i',
      resumeFlag: '--resume',
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
  mcp: geminiMcpAdapter(),
});
