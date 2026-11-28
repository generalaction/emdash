import {
  definePlugin,
  registerPluginBehavior,
} from '@emdash/core/services/agent-plugins/api/plugins';
import { buildStandardCommand } from '@emdash/core/services/agent-plugins/api/plugins/helpers';
import { icon } from './icon';

const uvInstall = {
  method: 'other',
  label: 'Install with uv (requires uv on PATH)',
  command: 'uv tool install pydantic-ai-pax',
  uninstallCommand: 'uv tool uninstall pydantic-ai-pax',
  recommended: true,
} as const;

export const plugin = definePlugin(
  {
    id: 'pax',
    name: 'Pax',
    description: "Pydantic's coding agent terminal, built on Pydantic AI Harness.",
    websiteUrl: 'https://github.com/pydantic/pydantic-ai/tree/main/src/pydantic_ai_pax',
  },
  {
    hostDependency: {
      id: 'pax',
      // `uv tool install pydantic-ai-pax` installs the same entry point as `pax` and
      // `pydantic-ai-pax`. Only the latter is probed: `pax` is also the POSIX archiver
      // (`/bin/pax` on macOS), and discovery is PATH-only, so it cannot tell the two apart.
      binaryNames: ['pydantic-ai-pax'],
      installCommands: {
        macos: [uvInstall],
        linux: [uvInstall],
      },
      installDocs: 'https://github.com/pydantic/pydantic-ai/tree/main/src/pydantic_ai_pax',
      // `pydantic-ai-pax update` installs the newest Pax with uv and exits.
      updateCommand: {
        kind: 'self',
        args: ['update'],
      },
    },
    prompt: {
      // Pax takes no prompt argument when it starts interactively (`-p` is a headless one-shot
      // that exits), so the prompt is typed into the TUI.
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
        // `--continue` restores the most recent session saved in the worktree, or starts a new
        // one when there is none. `--resume <id>` exits with an error for a session that was
        // never saved, which is the case when no message was sent before the app closed.
        resumeFlag: '--continue',
        modelFlag: '--model',
      }),
  },
});
