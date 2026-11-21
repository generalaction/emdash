import {
  definePlugin,
  registerPluginBehavior,
} from '@emdash/core/services/agent-plugins/api/plugins';
import { buildStandardCommand } from '@emdash/core/services/agent-plugins/api/plugins/helpers';
import { createNativeAcpBehavior } from '../../helpers/acp-stdio';
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
    acp: {
      kind: 'supported',
    },
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
      // `-q/--query` seeds an interactive session on a TTY; `-Q/--quiet` or
      // `--oneshot` is what makes it answer and exit. `chat` is required so -q
      // is parsed by the chat subcommand, not as a top-level positional.
      kind: 'argv',
      flag: '-q',
    },
    sessions: {
      kind: 'resumable',
    },
  },
  { icon }
);

export const provider = registerPluginBehavior(plugin, {
  acp: createNativeAcpBehavior(() => ({
    args: ['acp'],
  })),
  prompt: {
    buildCommand: (ctx) =>
      buildStandardCommand(ctx, {
        defaultArgs: ['chat'],
        autoApproveFlag: '--yolo',
        initialPromptFlag: '-q',
        resumeFlag: '--continue',
      }),
  },
});
