import { definePlugin, registerPluginBehavior } from '@emdash/shared/agents/plugins';
import { buildStandardCommand } from '@emdash/shared/agents/plugins/helpers';
import { buildKiroHookConfig } from './hooks';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'kiro',
    name: 'Kiro (AWS)',
    description:
      'Kiro CLI by AWS, focused on interactive terminal-first development assistance and workflow automation.',
    websiteUrl: 'https://kiro.dev/docs/cli/',
  },
  {
    acp: {
      kind: 'none',
    },
    autoApprove: {
      kind: 'supported',
    },
    effort: {
      kind: 'none',
    },
    hooks: {
      kind: 'config',
      scope: 'workspace',
      supportedEvents: ['session', 'start', 'stop'],
    },
    hostDependency: {
      id: 'kiro',
      binaryNames: ['kiro-cli'],
      installCommands: {
        macos: [
          {
            method: 'curl',
            command: 'curl -fsSL https://cli.kiro.dev/install | bash',
          },
        ],
        linux: [
          {
            method: 'curl',
            command: 'curl -fsSL https://cli.kiro.dev/install | bash',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: {
          kind: 'none',
        },
        update: {
          kind: 'package-manager',
        },
      },
    },
    mcp: {
      kind: 'none',
    },
    models: {
      kind: 'none',
    },
    plugins: {
      kind: 'none',
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
  prompt: {
    buildCommand: (ctx) =>
      buildStandardCommand(ctx, {
        defaultArgs: ['chat', '--agent', 'emdash'],
        autoApproveFlag: '--trust-all-tools',
        initialPromptFlag: '',
        resumeFlag: '--resume-id',
        sessionIdFlag: '--resume-id',
        sessionIdOnResumeOnly: true,
        resumeWithoutSessionFlag: '--resume',
      }),
  },
  hooks: buildKiroHookConfig(),
});
