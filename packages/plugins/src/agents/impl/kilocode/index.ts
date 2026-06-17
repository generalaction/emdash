import { definePlugin, registerPluginBehavior } from '@emdash/shared/agents/plugins';
import {
  buildStandardCommand,
  createFileDropPlugin,
  npmDependency,
} from '@emdash/shared/agents/plugins/helpers';
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
    autoApprove: {
      kind: 'supported',
    },
    effort: {
      kind: 'none',
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
    mcp: {
      kind: 'none',
    },
    models: {
      kind: 'none',
    },
    plugins: {
      kind: 'file-drop',
      scope: 'workspace',
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
        autoApproveFlag: '--auto',
        initialPromptFlag: '',
        resumeFlag: '--continue',
      }),
  },
  plugins: createFileDropPlugin({
    relativePath: KILOCODE_PLUGIN_PATH,
    content: KILOCODE_PLUGIN_CONTENT,
  }),
});
