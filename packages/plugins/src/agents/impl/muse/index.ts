import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import { buildStandardCommand } from '@emdash/core/agents/plugins/helpers';
import { icon } from './icon';

const installCommand = 'curl -fsSL https://dev.meta.ai/install.sh | bash';

export const plugin = definePlugin(
  {
    id: 'muse',
    name: 'Muse Code',
    description:
      "Meta's terminal coding agent powered by Muse Spark, with persistent subagents, skills, sandboxing, and long-running workflows.",
    websiteUrl: 'https://dev.meta.ai/docs/muse-code',
  },
  {
    autoApprove: {
      kind: 'supported',
    },
    hostDependency: {
      id: 'muse',
      binaryNames: ['muse'],
      installCommands: {
        macos: [
          {
            method: 'curl',
            command: installCommand,
            updateCommand: installCommand,
            recommended: true,
          },
        ],
        linux: [
          {
            method: 'curl',
            command: installCommand,
            updateCommand: installCommand,
            recommended: true,
          },
        ],
      },
      installDocs: 'https://dev.meta.ai/docs/muse-code',
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
      kind: 'stateless',
    },
  },
  { icon }
);

export const provider = registerPluginBehavior(plugin, {
  prompt: {
    buildCommand: (ctx) =>
      buildStandardCommand(ctx, {
        autoApproveFlag: '--yolo',
      }),
  },
});
