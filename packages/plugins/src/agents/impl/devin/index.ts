import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import { buildStandardCommand, nativeAcpBehavior } from '@emdash/core/agents/plugins/helpers';
import { buildDevinHookConfig } from './hooks';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'devin',
    name: 'Devin',
    description:
      "Cognition's Devin for Terminal agent for local, interactive coding sessions with Devin Cloud integration.",
    websiteUrl: 'https://docs.devin.ai/cli',
  },
  {
    acp: {
      kind: 'supported',
    },
    autoApprove: {
      kind: 'supported',
    },
    hooks: {
      kind: 'config',
      scope: 'workspace',
      supportedEvents: ['stop', 'notification'],
    },
    hostDependency: {
      id: 'devin',
      binaryNames: ['devin'],
      installCommands: {
        macos: [
          {
            method: 'curl',
            command: 'curl -fsSL https://cli.devin.ai/install.sh | bash',
          },
        ],
        linux: [
          {
            method: 'curl',
            command: 'curl -fsSL https://cli.devin.ai/install.sh | bash',
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
    prompt: {
      kind: 'argv',
      flag: '--',
    },
    sessions: {
      kind: 'resumable',
    },
  },
  { icon }
);

export const provider = registerPluginBehavior(plugin, {
  acp: nativeAcpBehavior(['acp']),
  prompt: {
    buildCommand: (ctx) =>
      buildStandardCommand(ctx, {
        autoApproveFlag: '--permission-mode=bypass',
        initialPromptFlag: '--',
        resumeFlag: '--continue',
      }),
  },
  hooks: buildDevinHookConfig(),
});
