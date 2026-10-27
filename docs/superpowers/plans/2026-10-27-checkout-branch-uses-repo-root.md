# Checkout branch uses repo root (plan)

1. Test (`use-workspace-config.test.ts`): checkout of `currentBranch` resolves to
   `{ git: none, workspace: repository-instance }`, is valid, has no setup steps.
2. `use-workspace-config.ts`: expose `usesRepositoryRoot`; short-circuit `resolvedConfig`.
3. `new-worktree-panel.tsx`: note that the task will run in the repository root.
4. `use-create-task-state.ts`: default task name = checked-out branch.
5. Run focused tests, typecheck, lint, format.
