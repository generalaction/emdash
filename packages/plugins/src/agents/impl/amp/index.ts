import { extname } from 'node:path';
import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import {
  ampMcpAdapter,
  buildStandardCommand,
  createFileDropPlugin,
  npmDependency,
} from '@emdash/core/agents/plugins/helpers';
import { createNativeAcpBehavior } from '../../helpers/acp-stdio';
import { icon } from './icon';
import { AMP_PLUGIN_CONTENT } from './plugin-file';

const AMP_PLUGIN_PATH = '.amp/plugins/emdash-hook.ts';
// Amp thread ids are prefixed with 'T-'; only accept those for resume.
const validateSessionId = (id: string) => id.startsWith('T-');
const npxCommandForAmpCli = (cli: string) => {
  const ext = extname(cli).toLowerCase();
  return ['.exe', '.cmd', '.bat', '.ps1'].includes(ext) ? 'npx.cmd' : 'npx';
};

export const plugin = definePlugin(
  {
    id: 'amp',
    name: 'Amp',
    description:
      'Amp Code CLI for agentic coding sessions against your repository from the terminal.',
    websiteUrl: 'https://ampcode.com/manual#install',
  },
  {
    acp: {
      kind: 'supported',
    },
    autoApprove: {
      kind: 'supported',
    },
    hooks: {
      kind: 'plugin',
      scope: 'workspace',
      supportedEvents: ['start', 'stop', 'session'],
    },
    hostDependency: npmDependency({
      id: 'amp',
      package: '@ampcode/cli',
      versionSuffix: '@latest',
    }),
    mcp: {
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio', 'http'],
    },
    models: {
      kind: 'selectable',
      modelOptions: {
        smart: {
          name: 'Smart',
          modelFeatures: { intelligence: 4, speed: 4 },
        },
        rush: {
          name: 'Rush',
          modelFeatures: { intelligence: 3, speed: 5 },
        },
        deep: {
          name: 'Deep',
          modelFeatures: { intelligence: 5, speed: 3 },
        },
      },
    },
    plugins: {
      kind: 'file-drop',
      scope: 'workspace',
    },
    prompt: {
      kind: 'stdin-pipe',
    },
    sessions: {
      kind: 'resumable',
    },
  },
  { icon }
);

export const provider = registerPluginBehavior(plugin, {
  // Amp's ACP bridge lives in the amp-acp package. Point it at Emdash's resolved
  // Amp CLI so credentials and managed installs stay aligned with the terminal path.
  acp: createNativeAcpBehavior((ctx) => ({
    command: npxCommandForAmpCli(ctx.cli),
    args: ['-y', 'amp-acp'],
    env: { AMP_CLI_PATH: ctx.cli },
  })),
  prompt: {
    buildCommand: (ctx) =>
      buildStandardCommand(ctx, {
        autoApproveFlag: '--dangerously-allow-all',
        initialPromptViaStdinPipe: true,
        extraEnv: { PLUGINS: 'all' },
        resumeFlag: 'threads continue',
        sessionIdFlag: 'threads continue',
        sessionIdOnResumeOnly: true,
        modelFlag: '-m',
      }),
  },
  mcp: ampMcpAdapter(),
  plugins: createFileDropPlugin({ relativePath: AMP_PLUGIN_PATH, content: AMP_PLUGIN_CONTENT }),
  sessions: { validateSessionId },
});
