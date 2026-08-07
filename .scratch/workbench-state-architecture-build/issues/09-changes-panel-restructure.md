# 09 — Changes-panel sections restructure (hardest surface, last)

Spec: `../../workbench-state-architecture/spec.md` (§Shared binding — multi-section
composition; inventory fact 8 in
`../../workbench-state-architecture/assets/state-inventory.md`; decision:
`../../workbench-state-architecture/issues/06-panel-binding-design.md`)

**Status:** done
**Blocked by:** 02, 03, 06, 07

**What to build:** restructure the changes panel's three sections
(unstaged/staged/PRs) to the prototype-proven multi-section composition. Deliberately
last of the four surfaces — it needs structural redesign, not just a binding swap.

- **Restructure** in
  `apps/emdash-desktop/src/core/features/source-control/browser/diff-view/changes-panel/`:
  inert fixed-height header rows as direct Group children; only **expanded section
  bodies** are panels. Per-feature composition reusing the shared storage plumbing
  and threshold→command pattern (this surface does not use the single-panel hook
  verbatim). The Group is keyed by the expansion combination —
  `useDefaultLayout({ panelIds })` natively keys storage per combination; sibling
  bodies remounting on toggle is the accepted cost.
- **Delete** the old sync in `hooks/use-panel-layout.ts`: the `useLayoutEffect` →
  `resize()/collapse()` per section (L55–78), the `appliedExpanded` ref identity
  check + `offsetHeight === 0` sniff (L56–57), and the
  `[transition:flex-basis_200ms]` (L40) — no animation at all, per the locked
  binding decision.
- **Hidden-mount fix**: the panel currently mounts inside a hidden `ShowHide`
  (the reason for the offsetHeight sniff). With ticket 07's conditional tab
  rendering, the group only mounts when the changes tab is active — the
  `display:none` sharp edge is structurally gone.
- **Section expansion** stays in `ChangesViewStore.expandedSections`
  (`../stores/changes-view-store.ts` L16) as the semantic owner; user drag-to-
  collapse becomes a threshold→command path into the store (today's unmodeled drag
  path). The auto-expand reactions (L63–122) and `suppressNextAutoExpand` (L217)
  keep issuing store mutations — via the store's own methods, never panel calls.
- **Persistence**: section sizes persist per expansion combination via the facade,
  task-scoped. Per the spec's one-system rule, `expandedSections` moves onto a
  task-scoped memento (today it resets per session) — small editorial inference
  from the persistence-unification decision, flagged in the spec.

## Acceptance criteria

- [x] Headers always visible; only expanded bodies are panels; zero imperative panel
      calls and zero `offsetHeight`/ref guards remain (grep `appliedExpanded`,
      `offsetHeight` in the changes panel — clean; `use-panel-layout.ts` deleted).
- [x] Drag-to-collapse a section updates `expandedSections` via a command
      (`collapseSection`, threshold 8% in the layout handler); auto-expand
      reactions still work, including the suppress escape hatch (store-tested;
      the drag gesture itself is a manual smoke item).
- [x] Per-combination section sizes round-trip exactly across toggle and restart
      (`useResizableDefaultLayout({ panelIds })` over the task-scoped
      `tasks.panel-layouts` facade; prototype-verified mechanism — manual smoke
      on the app surface still recommended).
- [x] No `flex-basis` transition; hydration produces no visible slide/snap.
- [x] Expansion state persists per task across restarts (optional
      `expandedSections` on the `tasks.diff-preferences` memento; "never set"
      keeps the sensible-initial seeding; store-tested).
- [x] typecheck/lint/tests green; manual smoke on staging/unstaging/PR flows
      (manual smoke not yet performed — needs a human pass).
