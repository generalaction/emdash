import { definePlugin, registerPluginBehavior } from '@emdash/shared/agents/plugins';
import {
  buildStandardCommand,
  createFileDropPlugin,
  opencodeMcpAdapter,
} from '@emdash/shared/agents/plugins/helpers';
import { OPENCODE_PLUGIN_CONTENT } from './plugin-file';

const OPENCODE_PLUGIN_PATH = '.opencode/plugins/emdash-notifications.js';
const validateSessionId = (id: string) => id.startsWith('ses');
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'opencode',
    name: 'OpenCode',
    description:
      'OpenCode CLI that interfaces with models for code generation and edits from the shell.',
    websiteUrl: 'https://opencode.ai/docs/cli/',
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
    hostDependency: {
      id: 'opencode',
      binaryNames: ['opencode'],
      installCommands: {
        macos: [
          {
            method: 'npm',
            command: 'npm install -g opencode-ai',
          },
        ],
        linux: [
          {
            method: 'npm',
            command: 'npm install -g opencode-ai',
          },
        ],
        windows: [
          {
            method: 'npm',
            command: 'npm install -g opencode-ai',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: {
          kind: 'npm',
          package: 'opencode-ai',
        },
        update: {
          kind: 'package-manager',
        },
      },
    },
    mcp: {
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio', 'http'],
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
      flag: '--prompt',
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
        extraEnv: ctx.autoApprove ? { OPENCODE_PERMISSION: '{"*":"allow"}' } : {},
        initialPromptFlag: '--prompt',
        resumeFlag: '--session',
        sessionIdFlag: '--session',
        sessionIdOnResumeOnly: true,
        resumeWithoutSessionFlag: '--continue',
        validateSessionId,
      }),
  },
  sessions: { validateSessionId },
  mcp: opencodeMcpAdapter(),
  plugins: createFileDropPlugin({
    relativePath: OPENCODE_PLUGIN_PATH,
    content: OPENCODE_PLUGIN_CONTENT,
  }),
});
