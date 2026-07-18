import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import {
  ampMcpAdapter,
  buildStandardCommand,
  createFileDropPlugin,
  npmDependency,
} from '@emdash/core/agents/plugins/helpers';
import { AMP_PLUGIN_CONTENT } from './plugin-file';

const AMP_PLUGIN_PATH = '.amp/plugins/emdash-hook.ts';
const LEGACY_MODEL_ALIASES: Record<string, string> = {
  deep: 'ultra',
  rush: 'low',
  smart: 'high',
};

// Amp thread ids are prefixed with 'T-'; only accept those for resume.
const validateSessionId = (id: string) => id.startsWith('T-');
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'amp',
    name: 'Amp',
    description:
      'Amp Code CLI for agentic coding sessions against your repository from the terminal.',
    websiteUrl: 'https://ampcode.com/manual#install',
  },
  {
    autoApprove: {
      kind: 'supported',
    },
    hooks: {
      kind: 'plugin',
      scope: 'workspace',
      supportedEvents: ['start', 'stop', 'session'],
    },
    hostDependency: npmDependency({
      id: 'amp',
      package: '@ampcode/cli',
      versionSuffix: '@latest',
    }),
    mcp: {
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio', 'http'],
    },
    models: {
      kind: 'selectable',
      modelOptions: {
        low: {
          name: 'Low',
          modelFeatures: { intelligence: 2, speed: 5 },
        },
        medium: {
          name: 'Medium',
          modelFeatures: { intelligence: 3, speed: 4 },
        },
        high: {
          name: 'High',
          modelFeatures: { intelligence: 4, speed: 3 },
        },
        ultra: {
          name: 'Ultra',
          modelFeatures: { intelligence: 5, speed: 2 },
        },
      },
    },
    plugins: {
      kind: 'file-drop',
      scope: 'workspace',
    },
    prompt: {
      kind: 'stdin-pipe',
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
      buildStandardCommand(
        { ...ctx, model: LEGACY_MODEL_ALIASES[ctx.model] ?? ctx.model },
        {
          autoApproveFlag: '--dangerously-allow-all',
          initialPromptViaStdinPipe: true,
          extraEnv: { PLUGINS: 'all' },
          resumeFlag: 'threads continue',
          sessionIdFlag: 'threads continue',
          sessionIdOnResumeOnly: true,
          modelFlag: '-m',
        }
      ),
  },
  mcp: ampMcpAdapter(),
  plugins: createFileDropPlugin({ relativePath: AMP_PLUGIN_PATH, content: AMP_PLUGIN_CONTENT }),
  sessions: { validateSessionId },
});
