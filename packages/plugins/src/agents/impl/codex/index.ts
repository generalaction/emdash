import { createRequire } from 'node:module';
import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import {
  buildStandardCommand,
  codexMcpAdapter,
  homebrewOption,
  npmDependency,
} from '@emdash/core/agents/plugins/helpers';
import { connectStdioAcp } from '../../helpers/acp-stdio';
import { authenticatedFromEnv, commandAuthStatus } from '../../helpers/auth';
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
    auth: {
      kind: 'supported',
      methods: [
        {
          kind: 'cli-login',
          id: 'codex-login',
          name: 'Sign in with Codex',
          args: ['login'],
          description: 'Open the Codex CLI sign-in flow in a terminal.',
        },
        {
          kind: 'api-key',
          id: 'openai-api-key',
          name: 'Use an OpenAI API key',
          envVars: [{ name: 'OPENAI_API_KEY', label: 'OpenAI API key' }],
          helpUrl: 'https://platform.openai.com/api-keys',
        },
      ],
    },
    models: {
      kind: 'selectable',
      modelOptions: {
        'gpt-5.6-sol': {
          name: 'GPT-5.6 Sol',
          description: 'Flagship GPT-5.6 model for the hardest agentic coding workflows.',
          modelFeatures: { intelligence: 5, speed: 2 },
        },
        'gpt-5.6-terra': {
          name: 'GPT-5.6 Terra',
          description: 'Balanced GPT-5.6 model for everyday coding work with lower cost.',
          modelFeatures: { intelligence: 5, speed: 4 },
        },
        'gpt-5.6-luna': {
          name: 'GPT-5.6 Luna',
          description: 'Fast and cost-efficient GPT-5.6 model for lighter coding tasks.',
          modelFeatures: { intelligence: 4, speed: 5 },
        },
        'gpt-5.5': {
          name: 'GPT-5.5',
          description: 'Frontier model for complex coding, research, and real-world work.',
          modelFeatures: { intelligence: 5, speed: 3 },
        },
        'gpt-5.4': {
          name: 'GPT-5.4',
          description: 'Strong model for everyday coding.',
          modelFeatures: { intelligence: 4, speed: 3 },
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
    hostDependency: npmDependency({
      id: 'codex',
      package: '@openai/codex',
      extraOptions: {
        macos: [homebrewOption({ formula: 'codex', cask: true })],
        linux: [homebrewOption({ formula: 'codex', cask: true })],
        windows: [
          {
            method: 'powershell',
            command:
              'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"',
            updateCommand:
              'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"',
          },
        ],
      },
    }),
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
  auth: {
    checkStatus: async (ctx) => {
      const envStatus = authenticatedFromEnv(ctx, ['OPENAI_API_KEY']);
      if (envStatus.kind === 'authenticated') return envStatus;
      return commandAuthStatus(ctx, ['login', 'status'], {
        authenticatedPattern: /authenticated|logged in|signed in/i,
        unauthenticatedPattern: /not authenticated|not logged in|not signed in|login required/i,
      });
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
