import {
  definePlugin,
  registerPluginBehavior,
} from '@emdash/core/services/agent-plugins/api/plugins';
import { buildStandardCommand } from '@emdash/core/services/agent-plugins/api/plugins/helpers';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'muse',
    name: 'Muse Code',
    description: "Meta's terminal coding agent for planning, writing, and validating code changes.",
    websiteUrl: 'https://developer.meta.com/ai/products/muse-code/',
  },
  {
    autoApprove: {
      kind: 'supported',
    },
    hostDependency: {
      id: 'muse',
      binaryNames: ['muse'],
      installDocs: 'https://developer.meta.com/ai/products/muse-code/',
      installCommands: {
        macos: [
          {
            method: 'curl',
            command: 'curl -fsSL https://dev.meta.ai/install.sh | bash',
            recommended: true,
          },
        ],
        linux: [
          {
            method: 'curl',
            command: 'curl -fsSL https://dev.meta.ai/install.sh | bash',
          },
        ],
      },
    },
    prompt: {
      kind: 'argv',
      flag: '',
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
        initialPromptFlag: '',
      }),
  },
});
