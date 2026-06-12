import { definePlugin, registerPluginBehavior } from '@emdash/shared/agents/plugins';
import { buildStandardCommand, codexMcpAdapter } from '@emdash/shared/agents/plugins/helpers';
import { buildCodexHookConfig } from './hooks';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'codex',
    name: 'Codex',
    description:
      'CLI that connects to OpenAI models for project-aware code assistance and terminal workflows.',
    websiteUrl: 'https://github.com/openai/codex',
  },
  {
    autoApprove: {
      kind: 'supported',
    },
    effort: {
      kind: 'none',
    },
    hooks: {
      kind: 'config',
      scope: 'global',
      supportedEvents: ['notification', 'stop', 'session'],
    },
    hostDependency: {
      id: 'codex',
      binaryNames: ['codex'],
      installCommands: {
        macos: [
          {
            method: 'npm',
            command: 'npm install -g @openai/codex',
          },
          {
            method: 'homebrew',
            command: 'brew install --cask codex',
            updateCommand: 'brew upgrade --cask codex',
          },
        ],
        linux: [
          {
            method: 'npm',
            command: 'npm install -g @openai/codex',
          },
          {
            method: 'homebrew',
            command: 'brew install --cask codex',
            updateCommand: 'brew upgrade --cask codex',
          },
        ],
        windows: [
          {
            method: 'npm',
            command: 'npm install -g @openai/codex',
          },
          {
            method: 'powershell',
            command:
              'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"',
            updateCommand:
              'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: {
          kind: 'npm',
          package: '@openai/codex',
        },
        update: {
          kind: 'package-manager',
        },
      },
    },
    mcp: {
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio'],
    },
    models: {
      kind: 'none',
    },
    plugins: {
      kind: 'none',
    },
    prompt: {
      kind: 'argv',
      flag: '',
    },
    sessions: {
      kind: 'resumable',
    },
  },
  { icon }
);

export const provider = registerPluginBehavior(plugin, {
  prompt: {
    buildCommand: (ctx) =>
      buildStandardCommand(ctx, {
        autoApproveFlag:
          '-c approval_policy="never" -c sandbox_mode="danger-full-access" --dangerously-bypass-hook-trust',
        initialPromptFlag: '',
        resumeFlag: 'resume',
        sessionIdFlag: ' ',
        sessionIdOnResumeOnly: true,
        resumeWithoutSessionFlag: 'resume --last',
        deduplicateFlags: ['--dangerously-bypass-approvals-and-sandbox'],
      }),
  },
  hooks: buildCodexHookConfig(),
  mcp: codexMcpAdapter(),
});
