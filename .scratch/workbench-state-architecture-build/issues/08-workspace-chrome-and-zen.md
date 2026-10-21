# 08 — Workspace chrome store, left sidebar conversion, zen mode as data

Spec: `../../workbench-state-architecture/spec.md` (§Chrome command stores incl. the
zen editorial call, §Sync contract; inventory facts 1–3 in
`../../workbench-state-architecture/assets/state-inventory.md`; decisions:
`../../workbench-state-architecture/issues/07-chrome-state-consolidation.md`)

**Status:** done
**Blocked by:** 02, 03, 04, 07

**What to build:** the second chrome-store instance, the workspace left sidebar flip,
and zen mode's move from a captured-closure ref to plain persisted data.

- **Workspace chrome store** (project-scoped memento):
  `{ leftSidebarOpen, zen: { active, restore } }`. Commands: `toggleLeftSidebar`,
  `enterZenMode` (computes and stores the restore snapshot of overridden workspace
  fields, then applies zen), `exitZenMode` (applies the restore). Zen persists with
  the document — restart in zen resumes zen with a working restore.
- **Left sidebar conversion** in
  `apps/emdash-desktop/src/renderer/lib/layout/layout-provider.tsx` and
  `apps/emdash-desktop/src/renderer/lib/layout/workspace-layout.tsx`: delete the
  `useState isLeftOpen` (L30), the imperative `setCollapsed` → `panel.collapse()/
  expand()` (L47–64), the `programmaticRef` + rAF guard (L35, L51–61), and the
  `onResize={syncLeftOpenFromPanel}` write-back (workspace-layout.tsx L36). Replace
  with `useCollapsiblePanelBinding` driven by `leftSidebarOpen`; the
  `hidden={!isLeftOpen}` handle hack dies with conditional rendering.
- **localStorage retirement**: `useResizableDefaultLayout({ id: 'workspace-outer',
  storage: localStorage })` (workspace-layout.tsx L17–20) switches to the
  project-scoped `LayoutStorage` facade. No data migration — old keys abandoned
  (one-time layout reset, per spec).
- **Zen mode**: delete `zenModeSnapshotRef` (layout-provider.tsx L36–40) and the
  captured `setCollapsed` closure passed from
  `apps/emdash-desktop/src/core/features/workbench/browser/window-scope.tsx`
  (L112–127). Per the spec's flagged editorial call: zen is workspace-chrome data;
  its restore covers workspace fields only; the task sidebar renders hidden while
  `zen.active` as a derived condition (no task-chrome mutation). The implicit
  exit-on-navigation cleanup (window-scope.tsx L136) becomes an explicit
  `exitZenMode` command at the navigation site.

## Acceptance criteria

- [x] `leftSidebarOpen` has one owner (workspace chrome store); `useState`,
      `programmaticRef`, rAF guard, and `onResize` write-back are deleted.
      (An ephemeral fallback flag exists only for the no-project /
      pre-hydration window — not a shadow copy of store state.)
- [x] Workspace outer sizes persist via the facade, project-scoped; no
      localStorage layout reads/writes remain anywhere (grep: remaining
      `localStorage` hits are onboarding/theme/update-notification, not layout).
- [x] Zen enter/exit are commands with DOM-free unit tests; restore survives restart
      (schema round-trip test); the stale-restore bug (toggle sidebar while in zen)
      is covered by a test.
- [x] Task sidebar hides while zen is active without any task-chrome write
      (`isSidebarOpen = !isSidebarCollapsed && !isZenActive` in main-panel.tsx).
- [x] `zenModeSnapshotRef` and the window-scope captured closure are gone (grep).
- [x] typecheck/lint/tests green; manual smoke on zen + sidebar flows **not run**
      (manual item — verify: toggle/drag-close left sidebar, zen enter/exit with
      keybinding, restart while in zen, sidebar toggle while in zen then exit).

Implementation notes: no hydration gate existed at the project boundary, so the
layout provider gates reads itself on the project space's `isHydrated`
observable and remounts the outer group (key) when the hydrated subject swaps
in. The implicit exit-on-navigation became an explicit `exitZenMode` dispatch
on `onDidNavigate` **traversal** events (restoration is excluded, which is what
lets restart-in-zen survive).
