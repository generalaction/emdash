import { defineMetadata, defineProvider } from '../../core';
import { buildStandardCommand, createFileDropPlugin } from '../../helpers';
import { PI_EXTENSION_CONTENT } from './plugin-file';

const PI_EXTENSION_PATH = '.pi/extensions/emdash-hook.ts';

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'pi',
  name: 'Pi',
  description:
    'Minimal terminal coding agent with multi-provider model support and extensible custom tools.',
  websiteUrl: 'https://github.com/earendil-works/pi/tree/main/packages/coding-agent',
  capabilities: {
    install: {
      binaryNames: ['pi'],
      installCommands: {
        macos: [
          {
            command: 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent',
            method: 'npm',
          },
        ],
        linux: [
          {
            command: 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent',
            method: 'npm',
          },
        ],
        windows: [
          {
            command: 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent',
            method: 'npm',
          },
        ],
      },
    },
    models: { kind: 'none' },
    effort: { kind: 'none' },
    promptDelivery: { kind: 'argv', flag: '' },
    sessions: { kind: 'resumable' },
    autoApprove: { kind: 'none' },
    hooks: { kind: 'plugin', scope: 'workspace', supportedEvents: ['stop'] },
    mcp: { kind: 'none' },
    plugin: { kind: 'file-drop', scope: 'workspace' },
    updates: {
      kind: 'supported',
      releaseSource: { kind: 'npm', package: '@earendil-works/pi-coding-agent' },
      update: { kind: 'package-manager' },
    },
  },
});

export const provider = defineProvider(metadata, {
  buildCommand: (ctx) =>
    buildStandardCommand(ctx, {
      initialPromptFlag: '',
      resumeFlag: '-c',
    }),
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
  plugin: createFileDropPlugin({ relativePath: PI_EXTENSION_PATH, content: PI_EXTENSION_CONTENT }),
});
