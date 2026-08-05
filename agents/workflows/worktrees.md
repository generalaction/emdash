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
- archiving runs the teardown script before releasing the mounted workspace, but preserves the
  worktree and uses provider detach semantics so the task can be restored; restore runs setup again
- deleting an already archived task does not rerun its lifecycle teardown script; it performs only
  remaining provider-destroy cleanup before removing persisted task and worktree state; successful
  archive lifecycle completion is recorded durably and reset when a new provisioning attempt begins,
  before workspace acquire/setup can create resources
- task-service provisioning, archive, delete, teardown, and restore entrypoints are serialized per
  task so lifecycle generation resets cannot overlap resource teardown
- terminate-mode project shutdown records both lifecycle and provider-destroy completion because task
  rows are retained; a later cold delete does not replay either phase for that setup generation
- cold BYOI tasks cannot be safely archived or deleted after their provider connection is lost;
  those operations fail without changing task or workspace state instead of skipping provider cleanup
- `shellSetup` runs inside each PTY before the interactive shell starts
- tmux wrapping has an app level default but is also project-configurable in Project Settings and affects PTY lifecycle behavior.
- `preservePatterns` never copies tracked files or `.emdash.json`
