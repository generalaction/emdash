import {
  definePlugin,
  registerPluginBehavior,
} from '@emdash/core/services/agent-plugins/api/plugins';
import { buildStandardCommand } from '@emdash/core/services/agent-plugins/api/plugins/helpers';
import { icon } from './icon';

const uvInstall = {
  method: 'other',
  label: 'Install with uv (requires uv on PATH)',
  command: 'uv tool install code-puppy',
  uninstallCommand: 'uv tool uninstall code-puppy',
  recommended: true,
} as const;

export const plugin = definePlugin(
  {
    id: 'code-puppy',
    name: 'Code Puppy',
    description: 'Terminal coding agent distributed as a build of Pax, built on Pydantic AI.',
    websiteUrl: 'https://github.com/mpfaffenberger/code_puppy',
  },
  {
    hostDependency: {
      id: 'code-puppy',
      binaryNames: ['code-puppy', 'pup'],
      installCommands: {
        macos: [uvInstall],
        linux: [uvInstall],
      },
      installDocs: 'https://github.com/mpfaffenberger/code_puppy',
      // `code-puppy update` installs the newest Code Puppy with uv and exits.
      updateCommand: {
        kind: 'self',
        args: ['update'],
      },
    },
    prompt: {
      // Code Puppy shares Pax's CLI: no prompt argument for an interactive start (`-p` is a
      // headless one-shot that exits), so the prompt is typed into the TUI.
      kind: 'pty-only',
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
        // As for Pax: `--continue` restores the worktree's most recent saved session or starts a
        // new one, where `--resume <id>` fails for a session that was never saved.
        resumeFlag: '--continue',
        modelFlag: '--model',
      }),
  },
});
