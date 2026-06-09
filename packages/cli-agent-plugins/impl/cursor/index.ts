import { defineMetadata, defineProvider } from '../../core';
import { buildStandardCommand, cursorMcpAdapter } from '../../helpers';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'cursor',
  name: 'Cursor',
  description: "Cursor's agent CLI; provides editor-style, project-aware assistance from the shell.",
  websiteUrl: 'https://cursor.com/docs/cli/overview',
  capabilities: {
    install: {
      binaryNames: ['cursor-agent'],
      installCommands: {
        macos: { command: 'curl https://cursor.com/install -fsS | bash', method: 'curl' },
        linux: { command: 'curl https://cursor.com/install -fsS | bash', method: 'curl' },
      },
    },
    models: { kind: 'none' },
    effort: { kind: 'none' },
    promptDelivery: { kind: 'argv', flag: '' },
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
      autoApproveFlag: '-f --approve-mcps',
      initialPromptFlag: '',
      resumeFlag: '--resume',
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
  mcp: cursorMcpAdapter(),
});
