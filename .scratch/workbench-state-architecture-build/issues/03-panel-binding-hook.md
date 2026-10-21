# 03 — `useCollapsiblePanelBinding` in `@emdash/ui`

Spec: `../../workbench-state-architecture/spec.md` (§Shared binding; decision:
`../../workbench-state-architecture/issues/06-panel-binding-design.md`)

**Status:** done
**Blocked by:** —

**What to build:** the one shared binding that replaces all four hand-rolled sync
sites. Start from the prototype on branch `prototype/panel-binding` (commit
`d5be8db9c`): `git checkout prototype/panel-binding -- packages/ui/src/react/primitives/resizable/`
gives `panel-binding-prototype.tsx` (storage stub + hook sketch) and
`panel-binding-prototype.stories.tsx` (three interactively verified stories).
Productionize it in `packages/ui/src/react/primitives/resizable/` next to `Resizable`.

- API: `useCollapsiblePanelBinding({ storageKey, storage, panelIds,
  collapsiblePanelId, open, onCloseRequest, closeThreshold })` returning
  `{ groupProps, collapsiblePanelProps }`. Depends only on react-resizable-panels
  types plus the exported `LayoutStorage` interface
  (`Pick<Storage, 'getItem' | 'setItem'>`, sync) — preserves the "consumers never
  import react-resizable-panels directly" boundary.
- Visibility is conditional rendering: `open` mounts/unmounts the panel and handle;
  the hook contains **no** imperative collapse/expand/resize/setLayout calls.
- Drag-to-close: watch `onLayoutChanged` for a size crossing `closeThreshold` and
  call `onCloseRequest` (a semantic command; the store unmounts the panel).
- **Generation-id guard inside the hook**: after each threshold-close, suffix the
  panel id with a generation counter so reopening does not restore the library's
  in-memory sub-threshold sliver (which would instantly re-close); strip the suffix
  before persisting so storage keys stay stable.
- **Sliver guard inside the hook**: `onLayoutChanged` also fires on mount and panel
  enter/leave reflows — skip persisting while closed; never persist sub-threshold
  sizes, so reopen restores the last good size.
- **No animation at all**: close = unmount instant, open = mount instant. Delete the
  prototype's enter-only transition.

## Acceptance criteria

- [x] Hook shipped in `packages/ui/src/react/primitives/resizable/` and exported;
      no react-resizable-panels types leak into consumers beyond existing exports.
- [x] Stories cover: drag persistence at pointer-up, threshold drag-to-close without
      sliver persistence, reopen restoring last good size (ported from the prototype,
      un-prototyped naming).
- [x] Unit/browser tests for the generation-id and sliver guards (regression tests for
      the poisoned-panel-memory trap).
- [x] `LayoutStorage` interface exported for the app facade (ticket 02).
- [x] `@emdash/ui` typecheck/lint/tests green; stories render in Storybook.

Shipped as `use-collapsible-panel-binding.ts` (+ `.test.tsx`, `.stories.tsx`) under
`Primitives/Resizable/PanelBinding` (stories: CollapsibleSidebar, TerminalDrawer,
SectionedPanel). Guards verified by 8 jsdom unit tests; stories verified via a
Storybook static build + headless render smoke of all three stories. Left manual:
interactive drag-gesture verification in Storybook (the prototype's original
interactive verification still holds; unit tests cover the guard logic).
