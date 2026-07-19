import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import {
  buildStandardCommand,
  npmDependency,
  passthroughMcpAdapter,
} from '@emdash/core/agents/plugins/helpers';
import { createNativeAcpBehavior } from '../../helpers/acp-stdio';
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
  prompt: {
    buildCommand: (ctx) =>
      buildStandardCommand(ctx, {
        autoApproveFlag: '--dangerously-skip-permissions',
        initialPromptFlag: '',
        modelFlag: '--model',
        resumeFlag: '--resume',
        sessionIdFlag: '--session-id',
      }),
  },
  mcp: passthroughMcpAdapter('.codebuddy/.mcp.json'),
});
