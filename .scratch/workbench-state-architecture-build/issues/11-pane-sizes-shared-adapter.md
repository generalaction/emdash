# 11 — Pane sizes onto the shared adapter; delete `TabGroupsSnapshot.paneSizes`

Spec: `../../workbench-state-architecture/spec.md` (§Pane-layout ownership; decision:
`../../workbench-state-architecture/issues/08-pane-layout-ownership.md`; inventory
fact 10 in `../../workbench-state-architecture/assets/state-inventory.md`)

**Status:** done
**Blocked by:** 02, 10

**What to build:** split-pane sizes leave the tab snapshot and join the shared
`LayoutStorage` facade — panes get zero special-case size code.

- **Stable-id verification first (spec requirement):** pane ids are
  `crypto.randomUUID()` at creation
  (`apps/emdash-desktop/src/core/primitives/workbench-shell/browser/tabs/pane-layout-store.ts`
  L398) but round-trip through the persisted snapshot on restore (L314–316), so they
  appear restart-stable. Verify with a restart-cycle test; if any path regenerates
  ids on restore, make ids stable before proceeding.
- **Wire `SplitPane`** (in
  `apps/emdash-desktop/src/core/features/tasks/browser/view/task-main-column.tsx`,
  seed at L166) to `useDefaultLayout` with the task-scoped facade, keyed
  `pane:${groupId}` — replacing the `defaultSize={paneLayout.paneSizes[i]}` seeding.
  Drag persistence now works for the first time (the old write-back was dead code —
  `setPaneSizes` has zero callers).
- **Delete** `TabGroupsSnapshot.paneSizes`, `PaneLayoutStore.paneSizes`,
  `setPaneSizes` (L201), and the size portions of `_redistributeSizes` /
  `restoreSnapshot` (L324–326, L423–425). Bump the snapshot memento schema version;
  no data migration (old `paneSizes` abandoned per spec).
- **Cleanup on destroy:** when a pane group is destroyed, delete its facade entry
  (the store knows the destroy moment — one call). A later re-split starts fresh
  from defaults.

## Acceptance criteria

- [x] No pane-size state in MobX or the snapshot; grep `paneSizes` in
      workbench-shell/workbench returns nothing.
- [x] Dragged split sizes persist across restart, keyed per group; closing a group
      deletes its storage entry (test).
- [x] Restart-stability regression test for group ids.
- [x] Stale-layout tolerance: restoring a layout whose panel count changed degrades
      gracefully (library validation — smoke test).
- [x] typecheck/lint/tests green.

## Build notes

- **Id stability finding:** pane-group ids are already restart-stable — restore
  reuses the persisted `groupId` verbatim (`restoreSnapshot` →
  `_createPaneStore(g.groupId)`); no path regenerates ids. No fix was needed;
  a three-session hydrate/persist regression test locks it in
  (`pane-layout-store.test.ts`, "pane group id restart stability").
- **Keying:** panel ids are `pane:${groupId}` (`splitPanePanelId` in
  `tasks/contributions/mementos.ts`); `useDefaultLayout({ id:
  'task-main-split', panelIds, storage })` derives the storage entry key from
  the id combination, so entries are keyed by the stable pane-group id set.
- **Destroy cleanup:** `PaneLayoutStore` gained an `onPaneDestroyed(paneId)`
  option fired from `closePane` (covers user close and auto-close; not fired
  for the constructor pane replaced during restore, nor on dispose).
  `TaskComposition` wires it to `deleteSplitPaneLayoutEntries`
  (task-composition-state.ts), which drops every stored entry referencing the
  destroyed group via the facade's `deleteEntry`.
- **Stale-layout tolerance:** structural — a changed pane combination produces
  a different entry key, so a stale layout is never read and panes fall back
  to even defaults; smoke-tested in
  `tasks/browser/view/split-pane-layout-persistence.test.ts`.
- **Schema:** `tasks.pane-layout` bumped to v2 (drops `paneSizes`); the frozen
  v1 schema keeps the field and the upgrade discards it (no migration).
