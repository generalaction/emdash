# 05 — Task chrome migration to the command store

Spec: `../../workbench-state-architecture/spec.md` (§Chrome command stores; decisions:
`../../workbench-state-architecture/issues/07-chrome-state-consolidation.md`,
`../../workbench-state-architecture/issues/03-sync-contract.md`)

**Status:** done
**Blocked by:** 04

**What to build:** replace the per-setter task chrome memento access in
`TaskComposition` with a task-chrome command store instance.

- State (memento `tasks.chrome`, per-task subject — schema currently in
  `apps/emdash-desktop/src/core/features/tasks/contributions/mementos.ts` L22–32):
  `{ sidebarCollapsed, sidebarTab, terminalDrawerOpen }`.
- Commands replace the setters in
  `apps/emdash-desktop/src/core/features/workbench/api/browser/task-composition.tsx`
  (`setSidebarCollapsed` L467, `setTerminalDrawerOpen` L482, sidebar-tab setter):
  `toggleSidebar`, `openSidebarTab(tab)` (enforces "changes/files tab ⇒ sidebar
  expanded" — kills the `setSidebarTab` + `setSidebarCollapsed` dance at
  `revealWorkspaceFile`, L459), `openTerminalDrawer` / `closeTerminalDrawer` /
  `toggleTerminalDrawer`.
- Third writers issue commands: the terminal-count auto-close reaction
  (task-composition.tsx L358–385, `setTerminalDrawerOpen(false)` at L375) calls
  `closeTerminalDrawer`.
- `focusedRegion` (L67) stays an ephemeral observable but is set only inside the
  drawer/tab commands — no hidden setter side effects (currently mutated inside
  `setTerminalDrawerOpen`).
- Derived getters (`isChangesPanelVisible` L471) read from the store.
- This ticket changes the state's owner and mutation path only; the panel-sync
  effects in `main-panel.tsx` / `task-main-column.tsx` stay untouched until tickets
  06/07 (per-surface wholesale flip).

## Acceptance criteria

- [x] All task chrome mutation goes through named commands; no direct memento field
      writes remain for chrome facts; grep for the old setters returns nothing.
- [x] Command unit tests (DOM-free) cover the tab⇒expanded invariant and the
      drawer/focusedRegion coupling.
- [x] Existing behavior preserved (sidebar tab reveal flows, terminal auto-close);
      existing task-composition tests updated and green.
- [x] No change yet to panel sync sites or rendering.

Shipped command set: `toggleSidebar`, `collapseSidebar`, `expandSidebar`,
`openSidebarTab(tab)`, `toggleSidebarTab(tab)` (absorbs the
`toggleTaskSidebarTab` helper), `openTerminalDrawer`, `closeTerminalDrawer`,
`toggleTerminalDrawer`, `focusRegion(region)` (ephemeral-only; the
focus-tracker analytics transition became a reaction on the ephemeral field).
`collapseSidebar`/`expandSidebar` exist for the titlebar deselect, the zen-mode
snapshot restore, and the main-panel `onResize` write-back (mechanically
swapped to commands; the sync effect itself flips in ticket 07). The
`onResize` write-back in task-main-column.tsx likewise now issues
`open/closeTerminalDrawer` (flips in ticket 06).
