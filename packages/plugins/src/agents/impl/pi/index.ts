import { definePlugin, registerPluginBehavior } from '@emdash/shared/agents/plugins';
import {
  buildStandardCommand,
  createFileDropPlugin,
  npmDependency,
} from '@emdash/shared/agents/plugins/helpers';
import { PI_EXTENSION_CONTENT } from './plugin-file';

const PI_EXTENSION_PATH = '.pi/extensions/emdash-hook.ts';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'pi',
    name: 'Pi',
    description:
      'Minimal terminal coding agent with multi-provider model support and extensible custom tools.',
    websiteUrl: 'https://github.com/earendil-works/pi/tree/main/packages/coding-agent',
  },
  {
    autoApprove: {
      kind: 'none',
    },
    effort: {
      kind: 'none',
    },
    hooks: {
      kind: 'plugin',
      scope: 'workspace',
      supportedEvents: ['stop'],
    },
    hostDependency: npmDependency({
      id: 'pi',
      package: '@earendil-works/pi-coding-agent',
      installFlags: '--ignore-scripts',
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
        initialPromptFlag: '',
        resumeFlag: '--session',
        sessionIdFlag: '--session',
        sessionIdOnResumeOnly: true,
      }),
  },
  plugins: createFileDropPlugin({ relativePath: PI_EXTENSION_PATH, content: PI_EXTENSION_CONTENT }),
});
