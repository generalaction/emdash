import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import type { AgentCommand, CommandContext } from '@emdash/core/agents/plugins';
import { buildStandardCommand } from '@emdash/core/agents/plugins/helpers';
import { addKimiHooksToConfigText, buildKimiHookConfig } from './hooks';

function injectKimiHooksIntoInlineConfig(args: string[]): string[] {
  return args.map((arg, index) => {
    if (arg === '--config' && args[index + 1] !== undefined) return arg;
    if (index > 0 && args[index - 1] === '--config') return addKimiHooksToConfigText(arg);
    if (arg.startsWith('--config='))
      return `--config=${addKimiHooksToConfigText(arg.slice('--config='.length))}`;
    return arg;
  });
}

function buildKimiCommand(ctx: CommandContext): AgentCommand {
  const cmd = buildStandardCommand(ctx, {
    autoApproveFlag: '--yolo',
    resumeFlag: '-S',
    sessionIdFlag: '-S',
    sessionIdOnResumeOnly: true,
    resumeWithoutSessionFlag: '-C',
    omitAutoApproveOnResume: true,
  });
  return { ...cmd, args: injectKimiHooksIntoInlineConfig(cmd.args) };
}
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'kimi',
    name: 'Kimi Code',
    description:
      'Kimi Code CLI by Moonshot AI, with shell execution, ACP, MCP, plugins, subagents, and lifecycle hooks.',
    websiteUrl: 'https://moonshotai.github.io/kimi-code/en/guides/getting-started.html',
  },
  {
    autoApprove: {
      kind: 'supported',
    },
    hooks: {
      kind: 'config',
      scope: 'global',
      supportedEvents: ['notification', 'stop', 'session', 'start'],
    },
    hostDependency: {
      id: 'kimi',
      binaryNames: ['kimi'],
      installCommands: {
        macos: [
          {
            method: 'curl',
            command: 'curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash',
          },
        ],
        linux: [
          {
            method: 'curl',
            command: 'curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: {
          kind: 'github',
          repo: 'moonshotai/kimi-code',
        },
        update: {
          kind: 'package-manager',
        },
      },
    },
    prompt: {
      kind: 'keystroke',
    },
    sessions: {
      kind: 'resumable',
    },
  },
  { icon }
);

export const provider = registerPluginBehavior(plugin, {
  prompt: {
    buildCommand: buildKimiCommand,
  },
  hooks: buildKimiHookConfig(),
  sessions: {
    validateSessionId: undefined,
  },
});
