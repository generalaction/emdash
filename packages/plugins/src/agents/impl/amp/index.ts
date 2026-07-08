import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { definePlugin, registerPluginBehavior } from '@emdash/core/agents/plugins';
import {
  ampMcpAdapter,
  buildStandardCommand,
  createFileDropPlugin,
  npmDependency,
} from '@emdash/core/agents/plugins/helpers';
import { createNativeAcpBehavior } from '../../helpers/acp-stdio';
import { AMP_ACP_ADAPTER_SCRIPT } from './acp-adapter-script';
import { icon } from './icon';
import { AMP_PLUGIN_CONTENT } from './plugin-file';

const AMP_PLUGIN_PATH = '.amp/plugins/emdash-hook.ts';
const AMP_ACP_ADAPTER_DIR = join(tmpdir(), 'emdash-amp-acp-adapter');
const AMP_ACP_ADAPTER_PATH = join(AMP_ACP_ADAPTER_DIR, 'adapter.cjs');
// Amp thread ids are prefixed with 'T-'; only accept those for resume.
const validateSessionId = (id: string) => id.startsWith('T-');

function ensureAmpAcpAdapterScript(): string {
  mkdirSync(AMP_ACP_ADAPTER_DIR, { recursive: true });
  writeFileSync(AMP_ACP_ADAPTER_PATH, AMP_ACP_ADAPTER_SCRIPT, 'utf8');
  return AMP_ACP_ADAPTER_PATH;
}

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
  // Amp does not expose a native ACP subcommand. Avoid `npx amp-acp` here: that
  // package resolves its bundled @ampcode/cli before AMP_CLI_PATH, which can run
  // a stale CLI and hang after creating the remote thread. This small adapter
  // speaks ACP over stdio and shells out to Emdash's resolved Amp CLI directly.
  acp: createNativeAcpBehavior((ctx) => ({
    command: process.execPath,
    args: [ensureAmpAcpAdapterScript()],
    env: { ELECTRON_RUN_AS_NODE: '1', AMP_CLI_PATH: ctx.cli },
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
