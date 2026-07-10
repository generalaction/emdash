import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import {
  buildStandardCommand,
  createFileDropPlugin,
  npmDependency,
} from '@emdash/core/agents/plugins/helpers';
import { createNativeAcpBehavior } from '../../helpers/acp-stdio';
import { icon } from './icon';
import { KILOCODE_PLUGIN_CONTENT } from './plugin-file';

const KILOCODE_PLUGIN_PATH = '.kilo/plugins/emdash-notifications.js';

export const plugin = definePlugin(
  {
    id: 'kilocode',
    name: 'Kilocode',
    description:
      'Kilo AI coding assistant with multiple modes, broad model support, and checkpoint-based workflows.',
    websiteUrl: 'https://kilo.ai/docs/cli',
  },
  {
    skills: {
      kind: 'supported',
      locations: [{ relativeDir: '.kilocode/skills', isolation: 'provider' }],
    },
    acp: {
      kind: 'supported',
    },
    autoApprove: {
      kind: 'supported',
    },
    hooks: {
      kind: 'plugin',
      scope: 'workspace',
      supportedEvents: ['notification', 'stop', 'session'],
    },
    hostDependency: npmDependency({
      id: 'kilocode',
      package: '@kilocode/cli',
      binaryNames: ['kilo'],
    }),
    plugins: {
      kind: 'file-drop',
      scope: 'workspace',
    },
    prompt: {
      kind: 'argv',
      // `kilo <positional>` is interpreted as the project directory and gets
      // realpath()'d, which throws ENAMETOOLONG on large prompts (ENG-1546).
      // The interactive TUI accepts the initial prompt via `--prompt` instead.
      flag: '--prompt',
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
        autoApproveFlag: '--auto',
        initialPromptFlag: '--prompt',
        resumeFlag: '--continue',
      }),
  },
  plugins: createFileDropPlugin({
    relativePath: KILOCODE_PLUGIN_PATH,
    content: KILOCODE_PLUGIN_CONTENT,
  }),
});
