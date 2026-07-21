import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import { buildStandardCommand, cursorMcpAdapter } from '@emdash/core/agents/plugins/helpers';
import { createNativeAcpBehavior } from '../../helpers/acp-stdio';
import { icon } from './icon';
import { buildCursorTrustBehavior } from './trust';

export const plugin = definePlugin(
  {
    id: 'cursor',
    name: 'Cursor',
    description:
      "Cursor's agent CLI; provides editor-style, project-aware assistance from the shell.",
    websiteUrl: 'https://cursor.com/docs/cli/overview',
  },
  {
    acp: {
      kind: 'supported',
    },
    autoApprove: {
      kind: 'supported',
    },
    hostDependency: {
      id: 'cursor',
      binaryNames: ['cursor-agent'],
      installCommands: {
        macos: [
          {
            method: 'curl',
            command: 'curl https://cursor.com/install -fsS | bash',
          },
        ],
        linux: [
          {
            method: 'curl',
            command: 'curl https://cursor.com/install -fsS | bash',
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
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio', 'http'],
    },
    models: {
      kind: 'selectable',
      modelOptions: {
        'gpt-5': {
          name: 'GPT-5',
          description: 'Cursor CLI documents gpt-5 as a model value for agent sessions.',
          modelFeatures: { intelligence: 5, speed: 4 },
        },
      },
    },
    prompt: {
      kind: 'argv',
      flag: '',
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
    args: ['acp'],
  })),
  prompt: {
    buildCommand: (ctx) =>
      buildStandardCommand(ctx, {
        autoApproveFlag: '--force --approve-mcps',
        initialPromptFlag: '',
        resumeFlag: '--resume',
        sessionIdFlag: '--resume',
        sessionIdOnResumeOnly: true,
        resumeWithoutSessionFlag: 'resume',
        modelFlag: '--model',
      }),
  },
  mcp: cursorMcpAdapter(),
  trust: buildCursorTrustBehavior(),
});
