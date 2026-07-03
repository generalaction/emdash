import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import {
  buildStandardCommand,
  createFileDropPlugin,
  mimocodeMcpAdapter,
  npmDependency,
} from '@emdash/core/agents/plugins/helpers';
import { icon } from './icon';
import { MIMOCODE_PLUGIN_CONTENT } from './plugin-file';

const MIMOCODE_PLUGIN_PATH = '.mimocode/plugins/emdash-notifications.js';

// MiMoCode session ids match `^ses.*` (inherited from its OpenCode base). The
// guard prevents resuming with the emdash conversation UUID that
// `conversation.sessionId` is seeded with before the first native id is captured.
const validateSessionId = (id: string) => id.startsWith('ses');

export const plugin = definePlugin(
  {
    id: 'mimocode',
    name: 'MiMo Code',
    description:
      "Xiaomi's terminal-native coding agent with persistent cross-session memory and OpenAI-compatible provider support.",
    websiteUrl: 'https://github.com/XiaomiMiMo/MiMo-Code',
  },
  {
    autoApprove: {
      kind: 'supported',
    },
    hooks: {
      kind: 'plugin',
      scope: 'workspace',
      supportedEvents: ['notification', 'stop', 'session'],
    },
    hostDependency: npmDependency({ id: 'mimo', package: '@mimo-ai/cli' }),
    mcp: {
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio', 'http'],
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
        extraEnv: ctx.autoApprove ? { MIMOCODE_PERMISSION: '{"*":"allow"}' } : {},
        initialPromptFlag: '--prompt',
        resumeFlag: '--session',
        sessionIdFlag: '--session',
        sessionIdOnResumeOnly: true,
        resumeWithoutSessionFlag: '--continue',
        validateSessionId,
      }),
  },
  sessions: { validateSessionId },
  mcp: mimocodeMcpAdapter(),
  plugins: createFileDropPlugin({
    relativePath: MIMOCODE_PLUGIN_PATH,
    content: MIMOCODE_PLUGIN_CONTENT,
  }),
});
