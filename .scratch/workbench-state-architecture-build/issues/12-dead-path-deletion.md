# 12 — Dead-path deletion

Spec: `../../workbench-state-architecture/spec.md` (§Explicit build requirements)

**Status:** done
**Blocked by:** 06, 07, 08, 09, 11

**What to build:** the surfaces delete their own guards as they flip; this ticket
sweeps up everything that outlives them.

- Any residual localStorage layout persistence: no `storage: localStorage` argument
  to `useResizableDefaultLayout` anywhere; decide whether `@emdash/ui` should keep
  accepting arbitrary `Storage` (fine — the app just never passes localStorage) and
  document the facade as the app-side default.
- Residual imperative panel plumbing: `useResizablePanelRef` call sites that only
  existed for collapse/expand; unused `ResizablePanelHandle` imports.
- Old guard remnants anywhere outside the four converted surfaces: `programmaticRef`,
  rAF timing flags around panels, `appliedExpanded`, `offsetHeight` visibility
  sniffs, first-call `prevPanelSize === undefined` skips.
- Dead chrome plumbing: any leftover layout-context fields from
  `apps/emdash-desktop/src/renderer/lib/layout/layout-provider.tsx` (`isLeftOpen`,
  `setCollapsed`, zen callbacks) and their consumers; prune the context type.
- Dead memento fields: old per-setter chrome schema versions, abandoned
  `paneSizes` schema remnants — confirm schema versions were bumped, not mutated
  (do not hand-edit old versions; versioned-schema conventions apply).
- Update `agents/` docs that describe the old patterns if any mention the retired
  sync/persistence paths (check `agents/conventions/renderer-patterns.md`).

## Acceptance criteria

- [x] Greps return nothing in app + packages/ui source: `programmaticRef`,
      `appliedExpanded`, `zenModeSnapshotRef`, `setPaneSizes`,
      `TabPersistenceAdapter`, `storage: localStorage` (layout contexts).
- [x] No unused exports remain in the touched modules (lint clean).
- [x] Docs updated where they described retired patterns.
- [x] typecheck/lint/tests green.
