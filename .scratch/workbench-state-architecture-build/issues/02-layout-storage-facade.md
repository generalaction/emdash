# 02 — `LayoutStorage` memento facade

Spec: `../../workbench-state-architecture/spec.md` (§Persistence model, §Shared
binding; decision: `../../workbench-state-architecture/issues/05-persistence-unification.md`)

**Status:** done
**Blocked by:** 01, 03

**What to build:** the synchronous storage adapter that lets `useDefaultLayout` (and
the binding hook) persist panel sizes through the memento system.

- Implement the `LayoutStorage` interface exported by the binding
  (`Pick<Storage, 'getItem' | 'setItem'>`, fully synchronous) as a facade over an
  already-hydrated memento. Suggested home: a new module under
  `apps/emdash-desktop/src/core/primitives/mementos/browser/` (e.g.
  `layout-storage.ts`) constructed from a `SubjectSpace` + a panel-layouts memento
  definition.
- Storage shape: one memento document per subject holding a
  `Record<string, string>` mapping the library's internal keys
  (`react-resizable-panels:${id}[:${panelIds}]`) to serialized layouts. Define a
  task-scoped `tasks.panel-layouts` memento in
  `apps/emdash-desktop/src/core/features/tasks/contributions/mementos.ts` and a
  project-scoped equivalent for workspace chrome surfaces (see spec editorial call on
  scoping).
- `getItem` reads the in-memory value synchronously — it is called on **every
  render** via `useSyncExternalStore`, so it must be fast and value-stable (return
  identical strings for unchanged layouts). `setItem` writes through the normal
  debounced memento path.
- **Dev assertion (spec requirement):** any read before `space.isHydrated` is a
  dev-mode assertion failure; in production, log and return the in-memory value. A
  missing gate must be a loud bug, never a silent layout reset.
- A `deleteEntry(key)` (or similar) for pane-group cleanup (ticket 11).

## Acceptance criteria

- [x] Facade implements the binding's `LayoutStorage`; unit tests cover round-trip,
      value stability of `getItem`, debounced write-through, and the pre-hydration
      dev assertion.
- [x] Task- and project-scoped panel-layouts mementos defined with versioned schemas.
- [x] No consumer wired yet (surfaces convert in their own tickets); typecheck/lint/
      tests green.
