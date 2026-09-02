# Drag-to-split pane design

Date: 2026-09-02
Status: approved

## Goal

Dragging a workbench tab (or a drawer terminal) to the left or right edge of a
pane's content region creates a new split pane on that side and moves the
dragged item into it — VS Code style, scoped to the existing flat horizontal
pane row. No vertical (top/bottom) splits: `PaneLayoutStore.groups` is a 1-D
array rendered in one horizontal `Resizable.Group`, and that model stays.

## UX

- While a drag is active, each pane with tabs exposes two invisible drop zones
  covering the outer 20% of its content region.
- Hovering a zone renders a half-pane highlight (`bg-foreground/10`, matching
  the existing move-into-pane highlight) where the new pane will land.
- Dropping inserts a new pane on that side; the tab moves there (terminal:
  opens there). Center drops keep today's move-into-pane behavior.
- Max pane count stays at the existing `MAX_PANE_COUNT` (8). At the cap, an
  edge drop falls back to moving the item into the hovered pane.

## Components

### Shared ID helper — `workbench-shell/browser/tabs/split-drop-id.ts`

`splitDropId(paneId, side)` → `pane-split-left-<paneId>` /
`pane-split-right-<paneId>`, plus `parseSplitDropId` and `isSplitDropId`.
Pane IDs are UUIDs with hyphens, so prefix slicing lives in one place,
mirroring the `pane-drop-` / `pane-content-` convention.

### Store — `pane-layout-store.ts`

- New action `insertPane(relativeToPaneId, side): string | undefined` —
  guards `MAX_PANE_COUNT`, splices a fresh pane via `_createPane()` at the
  correct index, returns its `paneId`.
- `handleDragEnd` handles split IDs before existing routing:
  - No-op guard: if the source pane holds only the dragged tab and the
    insertion slot is directly adjacent to it, return (avoids churning pane
    IDs and persisted layout for a visually identical result).
  - Otherwise `insertPane` + existing `moveTab` (resource preserved, tab
    activated, emptied source pane auto-closes via existing reaction).
  - At the cap: fall back to `moveTab` into the hovered pane.

### UI — `tabs/tab-bar/pane-split-drop-zones.tsx`, rendered by `pane-content.tsx`

`PaneSplitDropZones` mounts only during an active drag (`useDndContext()`)
and only in panes with tabs (splitting an empty pane is meaningless; the
center drop already covers it). Each side is an absolutely-positioned
20%-wide `useDroppable` strip plus, on `isOver`, a `pointer-events-none`
half-width highlight. Purely declarative; all guards live in the store.

### Drop routing — `task-main-column.tsx`

- Collision detection wraps `pointerWithin`: split-zone collisions win when
  present, since edge strips overlap the whole-pane `pane-content-*`
  droppable and dnd-kit's distance sort is not relied upon.
- Terminal drags: parse split IDs first → `insertPane` → `setActiveGroup` +
  `open('terminal', …, { target: { paneId } })`; at the cap, open in the
  hovered pane. Tab drags flow into `paneLayout.handleDragEnd` unchanged.

## Persistence

No schema changes. Pane snapshots are already generic over `groups`; a new
pane gets an even-share default size from the `SplitPaneLayout` fallback;
closed panes' layout-storage entries are cleaned via `onPaneDestroyed`.
Single-mount tab semantics untouched (existing tabs move, never duplicate).

## Testing

- Store-level unit tests in the existing
  `features/workbench/api/browser/tabs/pane-layout-store.test.ts`:
  `insertPane` index math, cap behavior, `handleDragEnd` split routing,
  no-op guard, cap fallback.
- `split-drop-id` round-trip tests colocated with the helper.
- Zone component is thin render logic; interaction verified manually in the
  running app (Playwright browser tests are skipped in CI).
