import { defineMetadata, defineProvider } from '../../core';
import { buildCodexHookConfig, buildStandardCommand, codexMcpAdapter } from '../../helpers';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'codex',
  name: 'Codex',
  description:
    'CLI that connects to OpenAI models for project-aware code assistance and terminal workflows.',
  websiteUrl: 'https://github.com/openai/codex',
  capabilities: {
    install: {
      binaryNames: ['codex'],
      installCommands: {
        macos: { command: 'npm install -g @openai/codex', method: 'npm' },
        linux: { command: 'npm install -g @openai/codex', method: 'npm' },
        windows: { command: 'npm install -g @openai/codex', method: 'npm' },
      },
    },
    models: { kind: 'none' },
    effort: { kind: 'none' },
    promptDelivery: { kind: 'argv', flag: '' },
    sessions: { kind: 'resumable' },
    autoApprove: { kind: 'supported' },
    hooks: { kind: 'config', scope: 'global', supportedEvents: ['notification', 'stop', 'session'] },
    mcp: { kind: 'supported', scope: 'global', supportedTransports: ['stdio'] },
    plugin: { kind: 'none' },
  },
});

export const provider = defineProvider(metadata, {
  buildCommand: (ctx) =>
    buildStandardCommand(ctx, {
      // `--dangerously-bypass-hook-trust` lets Codex run emdash's hooks without interactive trust.
      autoApproveFlag:
        '-c approval_policy="never" -c sandbox_mode="danger-full-access" --dangerously-bypass-hook-trust',
      initialPromptFlag: '',
      resumeFlag: 'resume',
      sessionIdFlag: ' ',
      sessionIdOnResumeOnly: true,
      resumeWithoutSessionFlag: 'resume --last',
      // Deduplicate --dangerously-bypass-approvals-and-sandbox from user extraArgs + our flag.
      deduplicateFlags: ['--dangerously-bypass-approvals-and-sandbox'],
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
  hooks: buildCodexHookConfig(),
  mcp: codexMcpAdapter(),
});
