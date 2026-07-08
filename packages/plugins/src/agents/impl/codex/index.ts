import { createRequire } from 'node:module';
import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import {
  buildStandardCommand,
  codexMcpAdapter,
  homebrewOption,
} from '@emdash/core/agents/plugins/helpers';
import { connectStdioAcp } from '../../helpers/acp-stdio';
import { buildCodexHookConfig } from './hooks';
import { icon } from './icon';

const _require = createRequire(import.meta.url);

function resolveCodexAcpEntry(): string {
  return _require.resolve('@agentclientprotocol/codex-acp/dist/index.js');
}

export const plugin = definePlugin(
  {
    id: 'codex',
    name: 'Codex',
    description:
      'CLI that connects to OpenAI models for project-aware code assistance and terminal workflows.',
    websiteUrl: 'https://github.com/openai/codex',
  },
  {
    acp: {
      kind: 'supported',
    },
    autoApprove: {
      kind: 'supported',
    },
    models: {
      kind: 'selectable',
      modelOptions: {
        'gpt-5.5': {
          name: 'GPT-5.5',
          description: 'Recommended Codex model for complex coding and agentic workflows.',
          modelFeatures: { intelligence: 5, speed: 3 },
        },
        'gpt-5.4-mini': {
          name: 'GPT-5.4 Mini',
          description: 'Faster Codex model for lighter coding tasks and subagents.',
          modelFeatures: { intelligence: 4, speed: 5 },
        },
        'gpt-5.3-codex-spark': {
          name: 'GPT-5.3 Codex Spark',
          description: 'Research-preview Codex model optimized for near-instant iteration.',
          modelFeatures: { intelligence: 2, speed: 5 },
        },
      },
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
            method: 'curl',
            command: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
            updateCommand: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
            recommended: true,
          },
          {
            method: 'npm',
            command: 'npm install -g @openai/codex',
            updateCommand: 'npm install -g @openai/codex',
            uninstallCommand: 'npm uninstall -g @openai/codex',
          },
          homebrewOption({ formula: 'codex', cask: true }),
        ],
        linux: [
          {
            method: 'curl',
            command: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
            updateCommand: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
            recommended: true,
          },
          {
            method: 'npm',
            command: 'npm install -g @openai/codex',
            updateCommand: 'npm install -g @openai/codex',
            uninstallCommand: 'npm uninstall -g @openai/codex',
          },
          homebrewOption({ formula: 'codex', cask: true }),
        ],
        windows: [
          {
            method: 'powershell',
            command:
              'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"',
            updateCommand:
              'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"',
            recommended: true,
          },
          {
            method: 'npm',
            command: 'npm install -g @openai/codex',
            updateCommand: 'npm install -g @openai/codex',
            uninstallCommand: 'npm uninstall -g @openai/codex',
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
      uninstall: {
        kind: 'package-manager',
      },
    },
    mcp: {
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio', 'http'],
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
  acp: {
    buildSpawn: (ctx) => ({
      command: process.execPath,
      args: [resolveCodexAcpEntry()],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        CODEX_PATH: ctx.cli,
      },
    }),
    connect: (io, toClient) => {
      return connectStdioAcp(io, toClient);
    },
  },
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
        modelFlag: '-m',
      }),
  },
  hooks: buildCodexHookConfig(),
  mcp: codexMcpAdapter(),
});
