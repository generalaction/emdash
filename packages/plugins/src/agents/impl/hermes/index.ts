import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import { buildStandardCommand } from '@emdash/core/agents/plugins/helpers';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'hermes',
    name: 'Hermes Agent',
    description:
      'Nous Research terminal agent with interactive chat, model-provider routing, skills, and session workflows.',
    websiteUrl: 'https://hermes-agent.nousresearch.com/docs/',
  },
  {
    autoApprove: {
      kind: 'supported',
    },
    hostDependency: {
      id: 'hermes',
      binaryNames: ['hermes'],
      installCommands: {
        macos: [
          {
            method: 'curl',
            command: 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash',
          },
        ],
        linux: [
          {
            method: 'curl',
            command: 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash',
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
      kind: 'keystroke',
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
        resumeFlag: '--continue',
        deduplicateFlags: ['--yolo'],
      }),
  },
});
