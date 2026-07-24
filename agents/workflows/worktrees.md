# Worktrees

## Main Files

- `src/main/core/projects/worktrees/worktree-service.ts`
- `src/main/core/projects/project-manager.ts`
- `src/main/core/terminals/runLifecycleScript.ts`
- `.emdash.json`

## Current Behavior

- task worktrees are created under the project's DB-backed worktree directory setting
- branch prefix defaults to `emdash` and is configurable in app settings
- generated task branch names use the configured prefix plus a random suffix by default; app repository settings can disable only the random suffix
- selected gitignored files are preserved into worktrees
- worktree creation is managed by the project provider pattern

## `.emdash.json`

`.emdash.json` stores optional shareable project settings. Supported runtime keys:

- `preservePatterns`
- `scripts.prepare`
- `scripts.setup`
- `scripts.run`
- `scripts.teardown`
- `shellSetup`

Base project settings are DB-backed Project Settings, not runtime `.emdash.json` keys:

- `worktreeDirectory`
- `defaultBranch`
- `baseRemote`
- `pushRemote`
- `tmux`
- `workspaceProvider`

## Rules

- do not hardcode worktree paths; use service helpers
- use lifecycle config for repo-specific bootstrap and teardown behavior
- `scripts.prepare` is blocking and runs after the workspace exists but before task providers,
  conversations, setup scripts, or run scripts start; keep it idempotent
- `scripts.setup` and `scripts.run` are runtime-triggered after `scripts.prepare` succeeds; they do
  not block task readiness
- `shellSetup` runs inside each PTY before the interactive shell starts
- tmux wrapping has an app level default but is also project-configurable in Project Settings and affects PTY lifecycle behavior.
- `preservePatterns` never copies tracked files or `.emdash.json`
