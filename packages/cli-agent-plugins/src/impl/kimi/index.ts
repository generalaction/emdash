import { defineMetadata, defineProvider } from '../../core';
import type { AgentCommand, CommandContext } from '../../core/command';
import { addKimiHooksToConfigText, buildKimiHookConfig, buildStandardCommand } from '../../helpers';

function injectKimiHooksIntoInlineConfig(args: string[]): string[] {
  return args.map((arg, index) => {
    if (arg === '--config' && args[index + 1] !== undefined) {
      return arg;
    }
    if (index > 0 && args[index - 1] === '--config') {
      return addKimiHooksToConfigText(arg);
    }
    if (arg.startsWith('--config=')) {
      return `--config=${addKimiHooksToConfigText(arg.slice('--config='.length))}`;
    }
    return arg;
  });
}

function buildKimiCommand(ctx: CommandContext): AgentCommand {
  const cmd = buildStandardCommand(ctx, {
    autoApproveFlag: '--yolo',
    // kimi: useKeystrokeInjection — no initialPromptFlag needed
    resumeFlag: '-S',
    sessionIdFlag: '-S',
    sessionIdOnResumeOnly: true,
    resumeWithoutSessionFlag: '-C',
    // Kimi preserves approval settings on resume; rejects --yolo with --continue/--session.
    omitAutoApproveOnResume: true,
  });
  return { ...cmd, args: injectKimiHooksIntoInlineConfig(cmd.args) };
}

export { default as Icon } from './icon';

export const metadata = defineMetadata({
  id: 'kimi',
  name: 'Kimi',
  description:
    'Kimi CLI by Moonshot AI, with shell execution, Zsh integration, ACP, and MCP support.',
  websiteUrl: 'https://moonshotai.github.io/kimi-cli/en/guides/getting-started.html',
  capabilities: {
    install: {
      binaryNames: ['kimi'],
      installCommands: {
        macos: [{ command: 'curl -LsSf https://code.kimi.com/install.sh | bash', method: 'curl' }],
        linux: [{ command: 'curl -LsSf https://code.kimi.com/install.sh | bash', method: 'curl' }],
      },
    },
    models: { kind: 'none' },
    effort: { kind: 'none' },
    promptDelivery: { kind: 'keystroke' },
    sessions: { kind: 'resumable' },
    autoApprove: { kind: 'supported' },
    hooks: {
      kind: 'config',
      scope: 'global',
      supportedEvents: ['notification', 'stop', 'session', 'start'],
    },
    mcp: { kind: 'none' },
    plugin: { kind: 'none' },
    updates: {
      kind: 'supported',
      releaseSource: { kind: 'github', repo: 'moonshotai/kimi-cli' },
      update: { kind: 'package-manager' },
    },
  },
});

export const provider = defineProvider(metadata, {
  buildCommand: buildKimiCommand,
  buildVersionProbeCommand: (b) => ({ command: b, args: ['--version'] }),
  hooks: buildKimiHookConfig(),
});
