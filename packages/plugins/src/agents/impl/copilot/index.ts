import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import {
  buildStandardCommand,
  copilotMcpAdapter,
  npmDependency,
} from '@emdash/core/agents/plugins/helpers';
import { createNativeAcpBehavior } from '../../helpers/acp-stdio';
import { buildCopilotHookConfig } from './hooks';
import { icon } from './icon';
import { buildCopilotTrustBehavior } from './trust';

export const plugin = definePlugin(
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    description:
      'GitHub Copilot CLI brings Copilot prompts to the terminal for code, shell, and search help.',
    websiteUrl: 'https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli',
  },
  {
    skills: {
      kind: 'supported',
      locations: [{ relativeDir: '.copilot/skills', isolation: 'provider' }],
    },
    acp: {
      kind: 'supported',
    },
    autoApprove: {
      kind: 'supported',
    },
    hooks: {
      kind: 'config',
      scope: 'workspace',
      supportedEvents: ['stop', 'session', 'notification'],
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
    trust: {
      kind: 'supported',
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
        autoApproveFlag: '--allow-all-tools',
        initialPromptFlag: '-i',
        resumeFlag: '--resume',
        sessionIdFlag: '--resume',
        sessionIdOnResumeOnly: true,
      }),
  },
  hooks: buildCopilotHookConfig(),
  mcp: copilotMcpAdapter(),
  trust: buildCopilotTrustBehavior(),
});
