import { definePlugin, registerPluginBehavior } from '@emdash/shared/agents/plugins';
import {
  ampMcpAdapter,
  buildStandardCommand,
  createFileDropPlugin,
  npmDependency,
} from '@emdash/shared/agents/plugins/helpers';
import { AMP_PLUGIN_CONTENT } from './plugin-file';

const AMP_PLUGIN_PATH = '.amp/plugins/emdash-hook.ts';
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
    effort: {
      kind: 'none',
    },
    hooks: {
      kind: 'plugin',
      scope: 'workspace',
      supportedEvents: ['start', 'stop'],
    },
    hostDependency: npmDependency({
      id: 'amp',
      package: '@sourcegraph/amp',
      versionSuffix: '@latest',
    }),
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
      kind: 'stdin-pipe',
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
        autoApproveFlag: '--dangerously-allow-all',
        initialPromptViaStdinPipe: true,
        extraEnv: { PLUGINS: 'all' },
      }),
  },
  mcp: ampMcpAdapter(),
  plugins: createFileDropPlugin({ relativePath: AMP_PLUGIN_PATH, content: AMP_PLUGIN_CONTENT }),
});
