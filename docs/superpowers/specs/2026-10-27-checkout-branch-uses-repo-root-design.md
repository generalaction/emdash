# Checkout branch: reuse repo root + branch-named task (design)

Create Task modal, "Create new worktree" preset:

- **Create new branch**: unchanged (new branch + new worktree).
- **Checkout branch**, branch held by the repository root (`currentBranch`): git refuses a
  second worktree for it (`git worktree add` exit 128). Resolve to the repository root
  workspace (`git: none`, `repository-instance`) instead of a `use-branch` worktree.
- **Checkout branch**, branch not held: unchanged (`use-branch` worktree for that branch).
- Checkout-branch tasks default their name to the checked-out branch (replaces the random
  placeholder; a typed name or an issue/PR-generated name still wins).

Out of scope: branches held by other (non-root) worktrees keep the existing conflict warning.
