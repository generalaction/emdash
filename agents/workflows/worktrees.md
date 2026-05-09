# Worktrees

## Main Files

- `src/main/core/projects/worktrees/worktree-service.ts`
- `src/main/core/projects/project-manager.ts`
- `src/main/core/terminals/runLifecycleScript.ts`
- `.emdash.json`

## Current Behavior

- task worktrees are created under `../worktrees/`
- branch prefix defaults to `emdash` and is configurable in app settings
- selected gitignored files are preserved into worktrees
- worktree creation is managed by the project provider pattern

## `.emdash.json`

Current supported keys:

- `preservePatterns`
- `scripts.setup`
- `scripts.run`
- `scripts.teardown`
- `shellSetup`
- `tmux`

## Rules

- do not hardcode worktree paths; use service helpers
- use lifecycle config for repo-specific bootstrap and teardown behavior
- `shellSetup` runs inside each PTY before the interactive shell starts
- tmux wrapping is project-configurable and affects PTY lifecycle behavior
