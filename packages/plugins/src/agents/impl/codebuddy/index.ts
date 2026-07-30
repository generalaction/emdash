import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import {
  buildStandardCommand,
  createMcpAdapter,
  npmDependency,
} from '@emdash/core/agents/plugins/helpers';
import { createNativeAcpBehavior } from '../../helpers/acp-stdio';
import { CODEBUDDY_EMDASH_HOOKS_PATH, buildCodeBuddyHookConfig } from './hooks';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'codebuddy',
    name: 'CodeBuddy Code',
    description:
      "Tencent's terminal coding agent for repository-aware implementation, debugging, and code analysis.",
    websiteUrl: 'https://www.codebuddy.ai/docs/cli/README',
  },
  {
    acp: {
      kind: 'supported',
    },
    autoApprove: {
      kind: 'supported',
    },
    hooks: {
      kind: 'config',
      scope: 'workspace',
      supportedEvents: ['notification', 'stop', 'session', 'start', 'tool-use-failure'],
    },
    hostDependency: npmDependency({
      id: 'codebuddy',
      package: '@tencent-ai/codebuddy-code',
      binaryNames: ['codebuddy', 'cbc'],
      installDocs: 'https://www.codebuddy.ai/docs/cli/quickstart',
    }),
    mcp: {
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio', 'http'],
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
  acp: createNativeAcpBehavior(() => ({
    args: ['--acp'],
  })),
  hooks: buildCodeBuddyHookConfig(),
  prompt: {
    buildCommand: (ctx) => {
      if (
        ctx.hooksEnabled &&
        ctx.extraArgs?.some((arg) => arg === '--settings' || arg.startsWith('--settings='))
      ) {
        throw new Error(
          'CodeBuddy additional parameters cannot include --settings while Emdash hooks are enabled; use CodeBuddy user, project, or local settings instead.'
        );
      }

      return buildStandardCommand(ctx, {
        defaultArgs: ctx.hooksEnabled ? ['--settings', CODEBUDDY_EMDASH_HOOKS_PATH] : undefined,
        autoApproveFlag: '--dangerously-skip-permissions',
        initialPromptFlag: '',
        modelFlag: '--model',
        resumeFlag: '--resume',
        sessionIdFlag: '--session-id',
      });
    },
  },
  mcp: createMcpAdapter({
    configPath: '.codebuddy/.mcp.json',
    format: 'json',
    serversKey: 'mcpServers',
    toNative(server) {
      const { name: _name, transport, ...entry } = server;
      if (!entry.type && transport) entry.type = transport;
      return entry;
    },
    fromNative(name, raw) {
      return { name, ...raw };
    },
  }),
});
