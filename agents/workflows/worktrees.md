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
- worktree creation is managed by the project provider pattern
- creation runs a fast foreground pipeline (`inspect → resolve-base → add-worktree → verify`);
  the base ref is fetched only when it is not locally resolvable
- gitignored files named in `preservePatterns` are copied from the repository into the new
  worktree as a durable background step, using copy-on-write (`cp -c` on APFS,
  `--reflink=auto` on Linux) with a plain-copy fallback; nothing is copied without
  configured patterns
- there are no built-in preserve defaults: the `.env` family is no longer copied
  automatically — projects that relied on it must add `preservePatterns` (behavior
  change in workspace-lifecycle-v2; `excludePatterns` was removed at the same time and
  stale keys are silently ignored)
- branch push and ref freshening also run as durable background steps after activation; a failed
  push surfaces as a "branch not pushed" task state with a manual retry

## `.emdash.json`

`.emdash.json` stores optional shareable project settings. Supported runtime keys:

- `preservePatterns` (gitignored files deliberately carried into new worktrees; empty unless configured)
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

## Rules

- do not hardcode worktree paths; use service helpers
- use lifecycle config for repo-specific bootstrap and teardown behavior
- `scripts.prepare` is blocking and runs after the workspace exists but before task providers,
  conversations, setup scripts, or run scripts start; keep it idempotent
- `scripts.prepare`, `scripts.setup`, and `scripts.run` wait for the background artifact copy to
  settle before running, since they may consume preserved files
- `scripts.setup` and `scripts.run` are runtime-triggered after `scripts.prepare` succeeds; they do
  not block task readiness
- `shellSetup` runs inside each PTY before the interactive shell starts
- tmux wrapping has an app level default but is also project-configurable in Project Settings and affects PTY lifecycle behavior.
- `preservePatterns` never copies tracked files or `.emdash.json`
