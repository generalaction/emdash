import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import { buildStandardCommand, npmDependency } from '@emdash/core/agents/plugins/helpers';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'qoder',
    name: 'Qoder CLI',
    description:
      'Qoder terminal agent for code review, implementation, debugging, and repository-aware automation.',
    websiteUrl: 'https://qoder.com/en/cli',
  },
  {
    autoApprove: {
      kind: 'supported',
    },
    hostDependency: npmDependency({
      id: 'qoder',
      package: '@qoder-ai/qodercli',
      binaryNames: ['qodercli'],
      installDocs: 'https://qoder.com/en/cli',
      extraOptions: {
        macos: [
          {
            method: 'curl',
            command: 'curl -fsSL https://qoder.com/install | bash',
          },
        ],
        linux: [
          {
            method: 'curl',
            command: 'curl -fsSL https://qoder.com/install | bash',
          },
        ],
        windows: [
          {
            method: 'powershell',
            command: 'irm https://qoder.com/install.ps1 | iex',
          },
        ],
      },
    }),
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
        autoApproveFlag: '--yolo',
        initialPromptFlag: '',
        resumeFlag: '-r',
        sessionIdFlag: '-r',
        sessionIdOnResumeOnly: true,
        resumeWithoutSessionFlag: '-c',
      }),
  },
});
