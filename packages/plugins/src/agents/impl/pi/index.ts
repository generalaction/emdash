import { definePlugin, registerPluginBehavior } from '@emdash/shared/agents/plugins';
import { buildStandardCommand, createFileDropPlugin } from '@emdash/shared/agents/plugins/helpers';
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
    hostDependency: {
      id: 'pi',
      binaryNames: ['pi'],
      installCommands: {
        macos: [
          {
            method: 'npm',
            command: 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent',
          },
        ],
        linux: [
          {
            method: 'npm',
            command: 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent',
          },
        ],
        windows: [
          {
            method: 'npm',
            command: 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: {
          kind: 'npm',
          package: '@earendil-works/pi-coding-agent',
        },
        update: {
          kind: 'package-manager',
        },
      },
    },
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
        resumeFlag: '-c',
      }),
  },
  plugins: createFileDropPlugin({ relativePath: PI_EXTENSION_PATH, content: PI_EXTENSION_CONTENT }),
});
