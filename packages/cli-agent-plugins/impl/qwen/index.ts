import { defineMetadata, defineProvider } from '../../core';
import { buildQwenHookConfig, buildStandardCommand, qwenMcpAdapter } from '../../helpers';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'qwen',
  name: 'Qwen Code',
  description:
    "Command-line interface to Alibaba's Qwen Code models for coding assistance and code completion.",
  websiteUrl: 'https://github.com/QwenLM/qwen-code',
  capabilities: {
    install: {
      binaryNames: ['qwen'],
      installCommands: {
        macos: { command: 'npm install -g @qwen-code/qwen-code', method: 'npm' },
        linux: { command: 'npm install -g @qwen-code/qwen-code', method: 'npm' },
        windows: { command: 'npm install -g @qwen-code/qwen-code', method: 'npm' },
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
      supportedEvents: ['notification', 'stop'],
    },
    mcp: { kind: 'supported', scope: 'global', supportedTransports: ['stdio', 'http'] },
    plugin: { kind: 'none' },
  },
});

export const provider = defineProvider(metadata, {
  buildCommand: (ctx) =>
    buildStandardCommand(ctx, {
      autoApproveFlag: '--yolo',
      initialPromptFlag: '-i',
      resumeFlag: '--continue',
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
  hooks: buildQwenHookConfig(),
  mcp: qwenMcpAdapter(),
});
