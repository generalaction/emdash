import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import { buildStandardCommand, junieMcpAdapter } from '@emdash/core/agents/plugins/helpers';
import { createNativeAcpBehavior } from '../../helpers/acp-stdio';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'junie',
    name: 'Junie',
    description:
      'JetBrains agentic coding CLI for interactive terminal and headless project workflows.',
    websiteUrl: 'https://junie.jetbrains.com/docs/junie-cli.html',
  },
  {
    acp: {
      kind: 'supported',
    },
    hostDependency: {
      id: 'junie',
      binaryNames: ['junie'],
      installCommands: {
        macos: [
          {
            method: 'curl',
            command: 'curl -fsSL https://junie.jetbrains.com/install.sh | bash',
          },
        ],
        linux: [
          {
            method: 'curl',
            command: 'curl -fsSL https://junie.jetbrains.com/install.sh | bash',
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
        sonnet: {
          name: 'Claude Sonnet',
          description: 'Junie alias for Claude Sonnet 4.6.',
          modelFeatures: { intelligence: 4, speed: 4 },
        },
        opus: {
          name: 'Claude Opus',
          description: 'Junie alias for Claude Opus 4.8.',
          modelFeatures: { intelligence: 5, speed: 2 },
        },
        gpt: {
          name: 'GPT',
          description: 'Junie alias for GPT-5.4.',
          modelFeatures: { intelligence: 5, speed: 4 },
        },
        'gpt-codex': {
          name: 'GPT Codex',
          description: 'Junie alias for GPT-5.3-Codex.',
          modelFeatures: { intelligence: 5, speed: 4 },
        },
        'gemini-pro': {
          name: 'Gemini Pro',
          description: 'Junie alias for Gemini 3.1 Pro Preview.',
          modelFeatures: { intelligence: 5, speed: 3 },
        },
        'gemini-flash': {
          name: 'Gemini Flash',
          description: 'Junie alias for Gemini 3 Flash.',
          modelFeatures: { intelligence: 4, speed: 5 },
        },
        grok: {
          name: 'Grok',
          description: 'Junie alias for Grok 4.3.',
          modelFeatures: { intelligence: 4, speed: 4 },
        },
      },
    },
    prompt: {
      kind: 'argv',
      flag: '--prompt',
    },
    sessions: {
      kind: 'resumable',
    },
  },
  { icon }
);

export const provider = registerPluginBehavior(plugin, {
  acp: createNativeAcpBehavior(() => ({
    args: ['--acp=true'],
  })),
  prompt: {
    buildCommand: (ctx) =>
      buildStandardCommand(ctx, {
        initialPromptFlag: '--prompt',
        modelFlag: '--model',
        sessionIdFlag: '--session-id',
        sessionIdAlways: true,
      }),
  },
  mcp: junieMcpAdapter(),
});
