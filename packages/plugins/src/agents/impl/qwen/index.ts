import { definePlugin, registerPluginBehavior } from '@emdash/shared/agents/plugins';
import { buildStandardCommand, qwenMcpAdapter } from '@emdash/shared/agents/plugins/helpers';
import { buildQwenHookConfig } from './hooks';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'qwen',
    name: 'Qwen Code',
    description:
      "Command-line interface to Alibaba's Qwen Code models for coding assistance and code completion.",
    websiteUrl: 'https://github.com/QwenLM/qwen-code',
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
      scope: 'workspace',
      supportedEvents: ['notification', 'stop'],
    },
    hostDependency: {
      id: 'qwen',
      binaryNames: ['qwen'],
      installCommands: {
        macos: [
          {
            method: 'npm',
            command: 'npm install -g @qwen-code/qwen-code',
          },
        ],
        linux: [
          {
            method: 'npm',
            command: 'npm install -g @qwen-code/qwen-code',
          },
        ],
        windows: [
          {
            method: 'npm',
            command: 'npm install -g @qwen-code/qwen-code',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: {
          kind: 'npm',
          package: '@qwen-code/qwen-code',
        },
        update: {
          kind: 'package-manager',
        },
      },
    },
    mcp: {
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio', 'http'],
    },
    models: {
      kind: 'none',
    },
    plugins: {
      kind: 'none',
    },
    prompt: {
      kind: 'argv',
      flag: '-i',
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
        autoApproveFlag: '--yolo',
        initialPromptFlag: '-i',
        resumeFlag: '--continue',
      }),
  },
  hooks: buildQwenHookConfig(),
  mcp: qwenMcpAdapter(),
});
