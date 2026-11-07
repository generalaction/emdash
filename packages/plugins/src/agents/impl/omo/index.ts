import { statSync } from 'node:fs';
import path from 'node:path';
import {
  definePlugin,
  registerPluginBehavior,
} from '@emdash/core/services/agent-plugins/api/plugins';
import {
  buildStandardCommand,
  createFileDropPlugin,
  npmDependency,
  type ConfigRootResolver,
} from '@emdash/core/services/agent-plugins/api/plugins/helpers';
import { icon } from './icon';
import { OMO_EXTENSION_CONTENT } from './plugin-file';

const resolveConfigRoot: ConfigRootResolver = ({ env, homeDir, platform, cwd }) => {
  const paths = platform === 'windows' ? path.win32 : path.posix;
  const getEnv = (name: string) =>
    platform === 'windows'
      ? env[Object.keys(env).find((key) => key.toUpperCase() === name) ?? name]
      : env[name];
  for (const name of ['OMO_CODING_AGENT_DIR', 'SENPI_CODING_AGENT_DIR', 'PI_CODING_AGENT_DIR']) {
    const value = getEnv(name)?.trim();
    if (!value) continue;
    // Windows rooted/drive-relative paths also need the launch drive/directory.
    const absolute =
      paths.isAbsolute(value) && (platform !== 'windows' || paths.parse(value).root.length > 1);
    if (!cwd && !absolute) return '';
    return cwd ? paths.resolve(cwd, value) : paths.normalize(value);
  }
  return paths.join(getEnv('HOME') || getEnv('USERPROFILE') || homeDir, '.omo', 'agent');
};

export class MissingOmOSessionError extends Error {
  constructor() {
    super('OmO Native resume requires a nonblank providerSessionId (the exact session file path).');
    this.name = 'MissingOmOSessionError';
  }
}

export const plugin = definePlugin(
  {
    id: 'omo',
    name: 'OmO Native',
    description: 'Terminal coding agent with native OmO workflows and exact-session resume.',
    websiteUrl: 'https://github.com/code-yeongyu/oh-my-openagent',
  },
  {
    hooks: {
      kind: 'plugin',
      scope: 'global',
      required: true,
      supportedEvents: ['session', 'start', 'stop', 'notification'],
    },
    hostDependency: npmDependency({ id: 'omo', package: 'omo-ai' }),
    plugins: { kind: 'file-drop', scope: 'global' },
    prompt: { kind: 'argv', flag: '--emdash-initial-prompt' },
    sessions: { kind: 'resumable', resumeFallback: 'error' },
  },
  { icon }
);

export const provider = registerPluginBehavior(plugin, {
  prompt: {
    buildCommand: (ctx) => {
      if (ctx.isResuming && !ctx.providerSessionId?.trim()) throw new MissingOmOSessionError();
      if (ctx.isResuming) {
        const file = ctx.providerSessionId!;
        if (!path.isAbsolute(file)) throw new MissingOmOSessionError();
        const stat = statSync(file);
        if (!stat.isFile() || stat.size === 0) {
          throw new Error(`OmO Native cannot resume an empty or non-file session: ${file}`);
        }
      }
      const command = buildStandardCommand(ctx, {
        modelFlag: '--model',
        resumeFlag: '--session',
        sessionIdFlag: '--session',
        sessionIdOnResumeOnly: true,
      });
      // The extension receives literal text; `--` alone still leaves @file expansion active.
      if (!ctx.isResuming && ctx.initialPrompt) {
        command.args.push(`--emdash-initial-prompt=${ctx.initialPrompt}`);
      }
      return command;
    },
  },
  plugins: createFileDropPlugin({
    resolveConfigRoot,
    relativePath: 'extensions/emdash-hook.js',
    content: OMO_EXTENSION_CONTENT,
  }),
});
