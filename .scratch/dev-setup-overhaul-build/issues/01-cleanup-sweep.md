# 01 — Cleanup sweep

**What to build:** the repo no longer carries the dead weight the dev-setup effort condemned:
the stray committed SQLite file, the two broken CI workflows (nix, windows-beta), the finished
one-shot import codemod, the redundant `db:setup` and `d` scripts, the unused `concurrently`
dependency, and the four known doc errors. A contributor reading the docs after this ticket
sees only commands and projects that actually exist. Full inventory with paths:
[spec PR 1](../../dev-setup-overhaul/spec.md).

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Every kill-list item from spec PR 1 is deleted, including the lockfile update for the
      removed dependency
- [x] The stray DB file's directory is gitignored so it can't come back
- [x] Doc corrections applied (quickstart delegation claim, nx.md project graph,
      `theme:build` → `build:theme`, AGENTS.md repository structure additions)
- [x] Repo-wide search finds no remaining references to the removed scripts or workflows
- [x] `pnpm run format && pnpm run lint && pnpm run typecheck && pnpm run test` unaffected
