import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import {
  buildStandardCommand,
  createFileDropPlugin,
  npmDependency,
} from '@emdash/core/agents/plugins/helpers';
import { connectStdioAcp } from '../../helpers/acp-stdio';
import { PI_EXTENSION_CONTENT } from './plugin-file';

const PI_EXTENSION_PATH = '.pi/extensions/emdash-hook.ts';
import { icon } from './icon';

const _require = createRequire(import.meta.url);

function resolvePiAcpEntry(): string {
  return join(dirname(_require.resolve('pi-acp/package.json')), 'dist/index.js');
}

export const plugin = definePlugin(
  {
    id: 'pi',
    name: 'Pi',
    description:
      'Minimal terminal coding agent with multi-provider model support and extensible custom tools.',
    websiteUrl: 'https://github.com/earendil-works/pi/tree/main/packages/coding-agent',
  },
  {
    acp: {
      kind: 'supported',
    },
    hooks: {
      kind: 'plugin',
      scope: 'workspace',
      supportedEvents: ['session', 'stop'],
    },
    hostDependency: npmDependency({
      id: 'pi',
      package: '@earendil-works/pi-coding-agent',
      installFlags: '--ignore-scripts',
    }),
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
  acp: {
    buildSpawn: (ctx) => ({
      command: process.execPath,
      args: [resolvePiAcpEntry()],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        PI_ACP_PI_COMMAND: ctx.cli,
        // Patched into pi-acp so Emdash can suppress its synthetic prelude without
        // changing the user's global or project-level Pi settings.
        PI_ACP_QUIET_STARTUP: 'true',
      },
    }),
    connect: connectStdioAcp,
  },
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
