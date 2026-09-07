# 07 — Task sidebar conversion

Spec: `../../workbench-state-architecture/spec.md` (§Sync contract, §Shared binding;
inventory facts 4–5 in
`../../workbench-state-architecture/assets/state-inventory.md`)

**Status:** done
**Blocked by:** 02, 03, 05, 06

**What to build:** flip the task sidebar — the worst echo loop in the app (three
owners: memento, RRP panel, `display:none`; completely unguarded `onResize` that
races and clobbers the hydrating persisted value at mount).

- In `apps/emdash-desktop/src/core/features/tasks/browser/main-panel.tsx`
  (`ReadyTaskMainPanel`): replace the store→panel `useEffect` → `collapse()/expand()`
  (L271–277) and the unguarded `onResize` → `setSidebarCollapsed` (L294–296) with
  `useCollapsiblePanelBinding`: `open` = `!sidebarCollapsed` from the task chrome
  store; `onCloseRequest` = the sidebar-collapse command; collapsed = panel and
  handle unmounted.
- In `apps/emdash-desktop/src/core/features/tasks/browser/view/task-sidebar.tsx`:
  delete the `display:none` wrapper (L15) — the third owner dies. Convert the three
  `ShowHide` tab wrappers (L17–25) to store-driven conditional rendering of the
  active tab (the law bans `display:none` visibility in workbench surfaces; if a tab
  body has expensive remount cost, note it — do not silently keep `display:none`).
- Sidebar width persists via the facade (task-scoped key). Below the ticket-01 gate
  there is no hydrating-default window, so the mount-echo bug class is structurally
  gone.

## Acceptance criteria

- [x] Sidebar collapsed state has exactly one owner (task chrome store); the RRP
      collapse (`collapsible`/`collapsedSize`/panel ref/`useEffect`) and the
      `display:none` wrapper are deleted.
- [x] Zero imperative panel calls and zero `onResize` store writes on this surface.
- [x] A collapsed-sidebar task opens collapsed with no flash and no
      mount-echo write to the memento. Verified structurally: collapsed = panel and
      handle unmounted, so the mount `onLayoutChanged` reflow carries no sidebar
      size and the binding's sliver guard skips it — covered by the binding unit
      test "never persists layouts reported while closed" and by the fact that the
      only command dispatch left on this surface is `onCloseRequest` (drag below
      threshold while open). No app-level mount harness exists for the full task
      composition, so no additional app test was added.
- [x] Drag-to-close collapses via `collapseSidebar`; reopen restores last width;
      width persists per task (threshold/sliver/generation behavior covered by the
      binding's unit tests; persistence by the layout-storage tests.
      `closeThreshold` = 8, documented in `main-panel.tsx`).
- [x] Tab switching (conversations/changes/files) works via conditional rendering
      of the active tab; `openSidebarTab` invariant (tab ⇒ expanded) holds at the
      store level (task-chrome-store tests). Remount-cost note in
      `task-sidebar.tsx`: changes-panel section sizes reset on tab switch until
      ticket 09 moves them onto shared layout storage; no tab body owns Monaco.
- [x] typecheck/lint/tests green.
- [ ] Manual smoke on sidebar flows (open/collapse, drag-to-close, tab switching,
      width restore) — not run; this session is code-only, needs a human pass in
      the running app.
