import { createRequire } from 'node:module';
import { Readable, Writable } from 'node:stream';
import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import {
  buildStandardCommand,
  codexMcpAdapter,
  homebrewOption,
  npmDependency,
} from '@emdash/core/agents/plugins/helpers';
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
          modelFeatures: { intelligence: 5, speed: 3 },
        },
        'gpt-5.4-mini': {
          name: 'GPT-5.4-Mini',
          modelFeatures: { intelligence: 4, speed: 4 },
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
      const stream = ndJsonStream(
        Writable.toWeb(io.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(io.stdout) as unknown as ReadableStream<Uint8Array>
      );
      return new ClientSideConnection((agent) => toClient(agent as never), stream);
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
