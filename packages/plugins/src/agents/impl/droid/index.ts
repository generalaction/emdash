import { definePlugin, registerPluginBehavior } from '@emdash/shared/agents/plugins';
import { buildStandardCommand, droidMcpAdapter } from '@emdash/shared/agents/plugins/helpers';
import { buildDroidHookConfig } from './hooks';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'droid',
    name: 'Droid',
    description: "Factory AI's agent CLI for running multi-step coding tasks from the terminal.",
    websiteUrl: 'https://docs.factory.ai/cli/getting-started/quickstart',
  },
  {
    autoApprove: {
      kind: 'none',
    },
    effort: {
      kind: 'none',
    },
    hooks: {
      kind: 'config',
      scope: 'workspace',
      supportedEvents: ['notification', 'stop', 'session'],
    },
    hostDependency: {
      id: 'droid',
      binaryNames: ['droid'],
      installCommands: {
        macos: [
          {
            method: 'curl',
            command: 'curl -fsSL https://app.factory.ai/cli | sh',
          },
        ],
        linux: [
          {
            method: 'curl',
            command: 'curl -fsSL https://app.factory.ai/cli | sh',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: {
          kind: 'none',
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
        initialPromptFlag: '',
        resumeFlag: '--resume',
        sessionIdFlag: '--resume',
        sessionIdOnResumeOnly: true,
      }),
  },
  hooks: buildDroidHookConfig(),
  mcp: droidMcpAdapter(),
});
