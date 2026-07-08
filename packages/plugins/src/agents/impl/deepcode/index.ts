import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import {
  buildStandardCommand,
  npmDependency,
  passthroughMcpAdapter,
} from '@emdash/core/agents/plugins/helpers';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'deepcode',
    name: 'Deep Code',
    description:
      'Open-source terminal coding assistant for DeepSeek-V4 with deep thinking, reasoning effort control, Agent Skills, and MCP support.',
    websiteUrl: 'https://api-docs.deepseek.com/quick_start/agent_integrations/deepcode',
  },
  {
    hostDependency: npmDependency({
      id: 'deepcode',
      package: '@vegamo/deepcode-cli',
    }),
    mcp: {
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio'],
    },
    prompt: {
      kind: 'keystroke',
    },
    sessions: {
      kind: 'stateless',
    },
  },
  { icon }
);

export const provider = registerPluginBehavior(plugin, {
  prompt: {
    buildCommand: (ctx) => buildStandardCommand(ctx, {}),
  },
  mcp: passthroughMcpAdapter('.deepcode/settings.json'),
});
