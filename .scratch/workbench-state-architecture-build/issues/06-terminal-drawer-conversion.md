# 06 — Terminal drawer conversion (first surface)

Spec: `../../workbench-state-architecture/spec.md` (§Sync contract, §Shared binding,
§Rollout order; inventory fact 6 in
`../../workbench-state-architecture/assets/state-inventory.md`)

**Status:** done
**Blocked by:** 02, 03, 05

**What to build:** flip the terminal drawer wholesale onto the new binding — the
simplest bidirectional surface (one boolean, one panel), chosen first to shake out
the binding in production.

In `apps/emdash-desktop/src/core/features/tasks/browser/view/task-main-column.tsx`:

- Replace the store→panel `useEffect` → `expand()/collapse()` (L38–44) and the
  panel→store `onResize` write-back with its first-call skip (L95–98) with
  `useCollapsiblePanelBinding`: `open` = `terminalDrawerOpen` from the task chrome
  store; `onCloseRequest` = `closeTerminalDrawer` command; drawer closed = panel
  (and handle) unmounted.
- Sizes persist via the `LayoutStorage` facade (task-scoped key); pick and document
  the `closeThreshold`.
- Delete the imperative panel ref usage for the drawer; no `onResize` store writes
  remain on this surface.
- xterm note: the drawer body unmounts on close — verify terminal sessions survive
  (PTY state is main-process-owned; the renderer view remounts). If the current code
  relied on keep-mounted-but-collapsed for xterm buffers, restore scrollback via the
  existing terminal re-attach path; do not fall back to `display:none`.

## Acceptance criteria

- [x] Drawer open/close is conditional rendering driven by the chrome store; zero
      imperative panel calls and zero `onResize` writes on this surface.
- [x] Drag-to-close issues `closeTerminalDrawer`; reopen restores the last good
      height (no sliver); height persists per task across restarts.
      (Threshold/sliver/generation behavior covered by the binding's unit tests;
      persistence by the layout-storage tests. `closeThreshold` = 10, documented
      in `task-main-column.tsx`.)
- [x] Terminal-count auto-close still works (via command, ticket 05) — the
      reaction in `task-composition.tsx` issues `closeTerminalDrawer`, untouched.
- [ ] Terminals keep working across close/reopen (content re-attached, no orphaned
      PTYs) — manual smoke. Code reading says safe: each session's xterm DOM is
      owned by its `FrontendPty` and reparented to the off-screen host on unmount
      (`usePty` cleanup), remounted with scrollback intact — same path tab
      switching already exercises.
- [x] The first-call-skip guard is deleted; typecheck/lint/tests green.
