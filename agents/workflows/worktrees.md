# Worktrees

## Main Files

- `src/main/services/WorktreeService.ts`
- `src/main/services/WorktreePoolService.ts`
- `src/main/services/LifecycleScriptsService.ts`
- `.emdash.json`

## Current Behavior

- task worktrees are created under `../worktrees/`
- branch prefix defaults to `emdash` and is configurable in app settings
- selected gitignored files are preserved into worktrees
- reserve worktrees are pre-created to reduce task startup latency

## `.emdash.json`

Current supported keys:

- `preservePatterns`
- `scripts.setup`
- `scripts.run`
- `scripts.stop`
- `scripts.teardown`
- `shellSetup`
- `tmux`

## Rules

- do not hardcode worktree paths; use service helpers
- use lifecycle config for repo-specific bootstrap and teardown behavior
- `shellSetup` runs inside each PTY before the interactive shell starts
- tmux wrapping is project-configurable and affects PTY lifecycle behavior
