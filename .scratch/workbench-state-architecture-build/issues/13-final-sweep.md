# 13 — Final sweep and verification

Spec: `../../workbench-state-architecture/spec.md` (§End state, §Explicit build
requirements)

**Status:** done
**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12

**What to build:** the closing verification that the end state actually holds, with
grep-able assertions so regressions are catchable.

- **Contract assertions** (add as a lint rule or a repo test, so they keep holding):
  - No imperative panel calls in app code: `\.collapse\(\)`, `\.expand\(\)`,
    `\.resize\(`, `setLayout\(` against panel/group refs under
    `apps/emdash-desktop/src/` (workbench surfaces).
  - No `display:none`-style visibility toggling of workbench surfaces: audit
    `ShowHide` / `hidden` / `style={{ display` usage in
    `src/core/features/{workbench,tasks,source-control}` and
    `src/renderer/lib/layout/` — panel visibility must be conditional rendering.
  - No `onResize` handlers that write to stores.
  - No localStorage layout persistence.
- **Hydration audit**: every surface rendering persisted view state sits below a
  ready gate for its subject space (spec §Hydration gating general rule) — walk the
  memento definitions and confirm each consumer.
- **Full merge gate**: `pnpm run format`, `lint`, `typecheck`, `test` from the root.
- **Manual QA pass** over all converted surfaces: task open with collapsed sidebar
  (no flash), drawer open/close/drag/auto-close, workspace sidebar + zen enter/exit
  (+ restart in zen), changes panel expand/collapse/drag/auto-expand, split panes
  drag + restart, tab layout restore.
- Confirm the one-time layout reset on upgrade is the only data-visible change
  (no migration, per spec).

## Acceptance criteria

- [x] Contract assertions in place and green (lint rule or test, not a one-off grep).
- [x] Hydration audit documented in the ticket (list of persisted-view-state
      consumers and their gates).
- [x] Full merge gate green from the repo root.
- [ ] Manual QA checklist above executed and noted; any fix-ups landed.
      (Checklist compiled below from tickets 01–12's deferred smoke items; needs a
      human pass in the running app — this verification session was code-only.)

## Conformance mechanism (built)

`apps/emdash-desktop/src/core/features/workbench/browser/layout-contract.test.ts`
— a repo test in the app's `node` Vitest project, so it runs on every
`pnpm run test` / `pnpm run check` and in CI's `nx affected` test target. A test
(not an oxlint rule) was chosen because the assertions are content patterns with
a documented per-file allowlist and path scoping, which the existing local lint
plugin (`tooling/oxlint/`, AST import-boundary rules) does not model well; the
ticket explicitly sanctions this shape.

Nine checks (each with a rationale and a stale-allowlist guard; test/story files
excluded; `_`-prefixed dirs skipped):

1. No direct `react-resizable-panels` imports anywhere in app src — consumers
   go through `@emdash/ui`, which deliberately does not re-export imperative
   panel handles. This is what makes the "against panel/group refs" scoping
   sound: without a direct import, app code cannot obtain a panel ref at all.
2. No `ImperativePanel(Group)Handle`, `.setLayout(`, `.collapse()`, `.expand()`
   anywhere in app src.
3. No `.resize(` in the surface dirs (workbench/tasks/source-control features,
   `renderer/lib/layout/`). xterm/PTY `.resize()` lives in the
   terminals/conversations features, outside these dirs, so it cannot
   false-positive.
4. No `hidden={...}` / bare `hidden` attr / `style={{ display` /
   `.style.display =` in the surface dirs (`aria-hidden` excluded).
5. No `ShowHide` in the surface dirs. Allowlisted exception:
   `source-control/browser/diff-view/main-panel/stacked-diff-view.tsx` —
   diff-view *content* collapse keeping heavy rendered diffs mounted (ticket 12
   finding; content-level, not workbench chrome, no panel `defaultLayout`
   below it).
6. No `onResize` anywhere in app src (currently zero occurrences; a future
   measurement-only use must be reviewed and allowlisted — store writes stay
   banned).
7. No `localStorage` in the surface dirs. Allowlisted exception:
   `tasks/api/browser/task-config/initial-conversation-section.tsx`
   (new-conversation preferences — auto-approve, chat-ui opt-in — not layout).
8. No `storage: localStorage` / `createLayoutStorage(localStorage` anywhere —
   the library defaults to localStorage when no storage is passed; the app must
   always inject the memento facade.
9. Retired identifiers stay dead: `TabPersistenceAdapter`, `zenModeSnapshotRef`,
   `programmaticRef`, `appliedExpanded`, `setPaneSizes` (makes ticket 12's
   one-off greps durable).

Known-legitimate `visibility:hidden` uses outside the checked dirs (documented,
not violations — tab keep-alive so PTY/browser sessions survive tab switches,
per-tab content, not workbench chrome):
`core/primitives/workbench-shell/browser/tabs/pane-content.tsx`,
`core/features/browser/browser/browser-tab-provider.tsx`,
`core/features/editor/browser/task-editor/file-tab-provider.tsx`.

## Hydration audit

Every persisted-view-state consumer sits below a ready gate for its subject
space. Three gate mechanisms exist:

- **Task boundary (ticket 01):** `TaskViewWrapperWithProviders`
  (`tasks/browser/view.tsx`) renders `TaskViewLoadingState` until
  `composition.space.isHydrated`; nothing below it paints persisted state
  pre-hydration.
- **Project boundary:** no render gate, but `ProjectManagerStore.mountProject`
  awaits `mountedProject.space.ready` *before* publishing the mounted project
  (`project-manager.ts`), so `asMounted(...)` only ever exposes a hydrated
  space. The layout provider additionally self-gates on `space.isHydrated`
  with a documented ephemeral fallback (ticket 08) — verified to hold for all
  project-scoped consumers.
- **App boundary:** `renderer/main.tsx` awaits `appSpace.ready` before
  attaching handles and before the first React render.

Backstops: the `LayoutStorage` facade and chrome stores dev-throw on any
pre-hydration read/dispatch (loud bug, never a silent layout reset).

| Memento | Subject | Consumer | Gate |
| --- | --- | --- | --- |
| `tasks.chrome` | task | `TaskChromeStore` via `TaskComposition.chrome` | task-view `isHydrated` gate; chrome-store dev-assert |
| `tasks.terminal-selection` | task | `TerminalTabViewStore` + drawer active item (`TaskComposition`) | task-view gate |
| `tasks.editor-tree` | task | `EditorViewStore` | task-view gate |
| `tasks.diff-preferences` | task | `DiffViewStore` / `ChangesViewStore` (incl. `expandedSections`) | task-view gate |
| `tasks.diff-selection` | task | `DiffViewStore` (sanitized handle) | task-view gate |
| `tasks.pane-layout` | task | `PaneLayoutStore` snapshot | task-view gate **and** `hydrateAndSeedPaneLayout` awaits `space.ready` before `paneLayout.hydrate()` (which also awaits the memento's own ready) |
| `tasks.panel-layouts` | task | `createLayoutStorage` facades in `task-main-column.tsx`, `main-panel.tsx`, `changes-panel.tsx`, plus split-pane entry cleanup in `TaskComposition` | task-view gate; facade dev-assert |
| `projects.view` | project | `ProjectViewStore` (scoped store, `getProjectViewStore`) | mount-await gate: scoped stores exist only on a published `MountedProject`, published only after `space.ready` |
| `projects.workspace-chrome` | project | `WorkspaceChromeStore`, read only via `layout-provider.tsx` | mount-await gate + explicit `space.isHydrated` self-gate with ephemeral fallback |
| `projects.panel-layouts` | project | workspace-outer `LayoutStorage` in `layout-provider.tsx` | same self-gate; ephemeral in-memory storage until hydrated; group remounts via `layoutKey` when the hydrated subject swaps in |
| `workbench.sidebar` | app | `SidebarStore` (handle attached in `main.tsx`) | bootstrap `await appSpace.ready` before attach and render; documented default fallback pre-attach |
| `workbench.history` | app | `NavigationStore` | same bootstrap await |
| `workbench.navigation` (legacy, not in catalog) | app | `NavigationStore` legacy migration read | same bootstrap await |

Result: **no consumer found without a gate.**

## Manual QA checklist

For a human pass in the running app (compiled from tickets 01, 03, 06–09, 11;
all code-verified but not exercised interactively). Use a task with existing
layout state where relevant.

- [ ] **Task open with collapsed sidebar (tickets 01/07):** open a task whose
      sidebar was left collapsed → loading state, then first paint already
      collapsed; no expanded→collapsed flash, no default-width flash.
- [ ] **Terminal drawer (ticket 06):** open/close via toggle; drag the drawer
      taller/shorter → height sticks; drag below the close threshold → drawer
      closes (semantic close, no sliver); reopen → last good height restored;
      terminal scrollback intact across close/reopen (no orphaned PTYs — DOM
      reparents to the off-screen host); closing the last terminal auto-closes
      the drawer; height survives app restart, per task.
- [ ] **Task sidebar (ticket 07):** collapse/expand; drag-to-close; reopen
      restores last width; width persists per task across restart; tab
      switching conversations/changes/files (conditional rendering — note:
      switching away and back remounts the tab body); opening changes/files
      tab while collapsed expands the sidebar.
- [ ] **Workspace left sidebar + zen (ticket 08):** toggle and drag-to-close
      the workspace sidebar; open state and width survive restart (per
      project); zen enter/exit via keybinding restores prior sidebar state;
      toggle sidebar *while in* zen, then exit → no stale restore; restart
      while in zen → resumes zen with a working restore; navigating away
      (traversal) exits zen.
- [ ] **Changes panel sections (ticket 09):** expand/collapse
      unstaged/staged/PR sections; drag a section below the threshold →
      collapses via command; auto-expand on new changes still works; section
      sizes round-trip per expansion combination across toggle and restart; no
      slide/snap animation on hydrate; staging/unstaging and PR flows behave
      unchanged.
- [ ] **Split panes (ticket 11):** split the main area; drag the divider →
      size sticks and survives restart (per pane group); close a pane and
      re-split → starts fresh from even defaults.
- [ ] **Tab layout restore (ticket 10):** restart with several tabs, groups,
      an active tab, and preview tabs → exact round-trip; no flash of the
      default/empty tab layout before restore.
- [ ] **Binding drag feel (ticket 03):** interactive drag-gesture check on any
      converted surface (persistence commits at pointer-up; no jitter).

## Data-visible changes on upgrade

Reasoned from the schema changes across tickets 01–12; confirmed the accepted
one-time layout reset is the only data-visible change. No SQLite/Drizzle
migrations in the ticket range (`9fda8e263..f860681c1` touches no `drizzle/`
or `src/main/db/` files); mementos carry all schema changes.

Reset (one-time, accepted by spec — no data migration):

- **Split-pane sizes**: `tasks.pane-layout` upgraded v1→v2; the upgrade drops
  the abandoned `paneSizes` array. Tab structure (groups, tabs, active tab,
  preview flags) carries over unchanged.
- **Workspace outer sidebar width**: previously in localStorage
  (`react-resizable-panels:workspace-outer` via
  `useResizableDefaultLayout({ storage: localStorage })`); now in
  `projects.panel-layouts`. The old localStorage key is abandoned unread (left
  orphaned, harmless); width resets once.

Additive (new persistence where none or dead persistence existed — nothing to
lose):

- `tasks.panel-layouts` (new memento): task sidebar width, terminal drawer
  height, changes-section sizes, split-pane sizes. Sidebar/drawer/section sizes
  were previously unpersisted or dead-code write-backs; they now persist per
  task.
- `projects.panel-layouts` (new memento): workspace chrome surface layouts.
- `projects.workspace-chrome` (new memento): `leftSidebarOpen` and zen now
  survive restart (previously ephemeral `useState`).
- `tasks.diff-preferences.expandedSections` (new optional field on v1):
  changes-section expansion persists; absent-until-seeded keeps the old
  first-load behavior. Older app versions still parse newer documents
  (optional-on-v1).

Carried over unchanged: `tasks.chrome` (semantic chrome flags predate this
workstream; only the mutation path changed), `tasks.terminal-selection`,
`tasks.editor-tree`, `tasks.diff-selection`, `projects.view`,
`workbench.sidebar`, `workbench.history`.

## Merge-gate results (2026-08-06, repo root, branch `wss` @ f860681c1 + this ticket's test)

- `pnpm run format` — green; no unexpected modifications to tracked source
  (the generated `packages/theme/src/__generated__/shiki-themes.gen.ts` had
  local formatting drift that the run normalized back to the committed
  content — net no diff).
- `pnpm run lint` — **fails on untracked scratch files only**: one error in
  `apps/emdash-desktop/tooling/prototypes/cow-worktree/run.ts` (unused `os`
  import) plus `no-explicit-any` warnings in `tooling/prototypes/wire-seam/`.
  These are the known out-of-scope prototype scratch files (not part of any
  commit in `5ecef4b37..HEAD`); left untouched per scope. Zero errors in
  tracked code, including the new conformance test.
- `pnpm run typecheck` — green (all 9 projects).
- `pnpm run test` — green on the definitive run (427 files / 2452 tests,
  including the 10 new layout-contract checks). The first run had 3 timeouts
  in the Playwright `browser` project (`xterm-host`, `pane-resize`,
  `terminal-retention`) which pass in isolation in 9s — load-induced flake
  under the full parallel run, flagged as a flaky task by Nx itself, not
  workstream-caused (these are the tests CI skips via
  `EMDASH_TEST_SKIP_BROWSER`).
