import { defineMetadata, defineProvider } from '../../core';
import { ampMcpAdapter, buildStandardCommand, createFileDropPlugin } from '../../helpers';
import { AMP_PLUGIN_CONTENT } from './plugin-file';

const AMP_PLUGIN_PATH = '.amp/plugins/emdash-hook.ts';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'amp',
  name: 'Amp',
  description:
    'Amp Code CLI for agentic coding sessions against your repository from the terminal.',
  websiteUrl: 'https://ampcode.com/manual#install',
  capabilities: {
    install: {
      binaryNames: ['amp'],
      installCommands: {
        macos: { command: 'npm install -g @sourcegraph/amp@latest', method: 'npm' },
        linux: { command: 'npm install -g @sourcegraph/amp@latest', method: 'npm' },
        windows: { command: 'npm install -g @sourcegraph/amp@latest', method: 'npm' },
      },
    },
    models: { kind: 'none' },
    effort: { kind: 'none' },
    // Amp receives the initial prompt via stdin pipe
    promptDelivery: { kind: 'stdin-pipe' },
    sessions: { kind: 'stateless' },
    autoApprove: { kind: 'supported' },
    hooks: { kind: 'plugin', scope: 'workspace', supportedEvents: ['start', 'stop'] },
    mcp: { kind: 'supported', scope: 'global', supportedTransports: ['stdio', 'http'] },
    plugin: { kind: 'file-drop', scope: 'workspace' },
  },
});

export const provider = defineProvider(metadata, {
  buildCommand: (ctx) =>
    buildStandardCommand(ctx, {
      autoApproveFlag: '--dangerously-allow-all',
      initialPromptViaStdinPipe: true,
      // Amp requires PLUGINS=all env var to load plugins
      extraEnv: { PLUGINS: 'all' },
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
  mcp: ampMcpAdapter(),
  plugin: createFileDropPlugin({ relativePath: AMP_PLUGIN_PATH, content: AMP_PLUGIN_CONTENT }),
});
