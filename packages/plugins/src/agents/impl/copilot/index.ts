import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import {
  buildStandardCommand,
  copilotMcpAdapter,
  npmDependency,
} from '@emdash/core/agents/plugins/helpers';
import { buildCopilotHookConfig } from './hooks';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    description:
      'GitHub Copilot CLI brings Copilot prompts to the terminal for code, shell, and search help.',
    websiteUrl: 'https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli',
  },
  {
    autoApprove: {
      kind: 'supported',
    },
    hooks: {
      kind: 'config',
      scope: 'workspace',
      supportedEvents: ['start', 'stop', 'error', 'session', 'notification'],
    },
    hostDependency: npmDependency({ id: 'copilot', package: '@github/copilot' }),
    mcp: {
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio', 'http'],
    },
    prompt: {
      kind: 'argv',
      flag: '-i',
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
        autoApproveFlag: '--allow-all-tools',
        initialPromptFlag: '-i',
        resumeFlag: '--resume',
        sessionIdFlag: '--resume',
        sessionIdOnResumeOnly: true,
      }),
  },
  hooks: buildCopilotHookConfig(),
  mcp: copilotMcpAdapter(),
});
