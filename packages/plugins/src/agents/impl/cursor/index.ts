import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import {
  buildStandardCommand,
  cursorMcpAdapter,
  nativeAcpBehavior,
} from '@emdash/core/agents/plugins/helpers';
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
  acp: nativeAcpBehavior(['acp']),
  prompt: {
    buildCommand: (ctx) =>
      buildStandardCommand(ctx, {
        autoApproveFlag: '-f --approve-mcps',
        initialPromptFlag: '',
        resumeFlag: '--resume',
      }),
  },
  mcp: cursorMcpAdapter(),
  trust: buildCursorTrustBehavior(),
});
