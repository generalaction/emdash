import type { CommandContext } from '@emdash/core/agents/plugins';
import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import { buildStandardCommand, createFileDropPlugin } from '@emdash/core/agents/plugins/helpers';
import { createNativeAcpBehavior } from '../../helpers/acp-stdio';
import { icon } from './icon';
import { OH_MY_PI_EXTENSION_CONTENT } from './plugin-file';

const OH_MY_PI_EXTENSION_PATH = '.omp/extensions/emdash-hook.ts';
const OH_MY_PI_EXTENSION_ARG = `./${OH_MY_PI_EXTENSION_PATH}`;

export const plugin = definePlugin(
  {
    id: 'oh-my-pi',
    name: 'Oh My Pi',
    description:
      'Terminal-first coding agent with LSP, debugger, subagents, browser tools, and ACP support.',
    websiteUrl: 'https://omp.sh',
  },
  {
    acp: {
      kind: 'supported',
    },
    hooks: {
      kind: 'plugin',
      scope: 'workspace',
      supportedEvents: ['session', 'stop'],
    },
    hostDependency: {
      id: 'oh-my-pi',
      binaryNames: ['omp'],
      installCommands: {
        macos: [
          {
            method: 'curl',
            command: 'curl -fsSL https://omp.sh/install | sh',
            recommended: true,
          },
          {
            method: 'homebrew',
            command: 'brew install can1357/tap/omp',
            updateCommand: 'brew upgrade can1357/tap/omp',
            uninstallCommand: 'brew uninstall can1357/tap/omp',
          },
          {
            method: 'other',
            label: 'Bun',
            command: 'bun install -g @oh-my-pi/pi-coding-agent',
            updateCommand: 'bun install -g @oh-my-pi/pi-coding-agent',
            uninstallCommand: 'bun remove -g @oh-my-pi/pi-coding-agent',
          },
        ],
        linux: [
          {
            method: 'curl',
            command: 'curl -fsSL https://omp.sh/install | sh',
            recommended: true,
          },
          {
            method: 'other',
            label: 'Bun',
            command: 'bun install -g @oh-my-pi/pi-coding-agent',
            updateCommand: 'bun install -g @oh-my-pi/pi-coding-agent',
            uninstallCommand: 'bun remove -g @oh-my-pi/pi-coding-agent',
          },
        ],
        windows: [
          {
            method: 'powershell',
            command: 'irm https://omp.sh/install.ps1 | iex',
            recommended: true,
          },
          {
            method: 'other',
            label: 'Bun',
            command: 'bun install -g @oh-my-pi/pi-coding-agent',
            updateCommand: 'bun install -g @oh-my-pi/pi-coding-agent',
            uninstallCommand: 'bun remove -g @oh-my-pi/pi-coding-agent',
          },
        ],
      },
      installDocs: 'https://omp.sh/docs/quickstart',
      updates: {
        kind: 'supported',
        releaseSource: { kind: 'github', repo: 'can1357/oh-my-pi' },
        update: { kind: 'package-manager' },
      },
      uninstall: { kind: 'package-manager' },
    },
    plugins: {
      kind: 'file-drop',
      scope: 'workspace',
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
    args: ['acp'],
  })),
  prompt: {
    buildCommand: (ctx: CommandContext) =>
      buildStandardCommand(ctx, {
        defaultArgs: ['--extension', OH_MY_PI_EXTENSION_ARG],
        initialPromptFlag: '',
        resumeFlag: '--session',
        sessionIdFlag: '--session',
        sessionIdOnResumeOnly: true,
        modelFlag: '--model',
      }),
  },
  plugins: createFileDropPlugin({
    relativePath: OH_MY_PI_EXTENSION_PATH,
    content: OH_MY_PI_EXTENSION_CONTENT,
  }),
});
