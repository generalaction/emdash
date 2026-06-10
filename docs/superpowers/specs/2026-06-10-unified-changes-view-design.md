# Unified Changes View — Design

Date: 2026-06-10
Status: Draft

## Problem

The diff view's `ChangesPanel` exposes three collapsible sections:

- **Unstaged** — working-tree modifications.
- **Staged** — index modifications.
- **Pull Request** — files in the active PR.

Users reviewing what they're about to ship have to scan all three and mentally
merge them. There is no single place to answer "what is the total delta this
branch introduces, including local work that isn't pushed yet?"

This is especially painful when local commits exist that aren't yet in the PR
(or no PR exists yet) and the user wants a single review surface.

## Goals

1. One-screen review of every change a branch introduces, regardless of
   working-tree / index / committed-unpushed / pushed-PR state.
2. Read-only review surface — no stage/unstage/revert from this view.
3. Reuse the existing list / tree / virtualization / diff renderer.
4. Same data refresh pipeline as today's status — no new poll loops.

## Non-Goals

- Hunk- or file-level actions in the unified view (stage, unstage, revert).
- Detection or special handling of `.gitignore`-matched files.
  Files matching `.gitignore` do not appear in normal `git status`, and we are
  explicitly **not** adding `git status --ignored` support in this iteration.
- Layer attribution (no badges showing "this hunk came from the index" etc.).
- A user-configurable diff base. The base is derived automatically.

## User-facing behavior

- A new toggle in the `ChangesPanel` header switches between **Split**
  (today's three-section layout) and **Unified**.
- In Unified mode the panel shows one full-height list (or tree, respecting
  the existing list/tree toggle). One row per changed file.
- Diff base resolution:
  - If the active task has a Pull Request: use the PR's base ref.
  - Else: use the project's configured default branch.
  - Else: empty state with a link to configure the default branch.
- Diff source per file: `merge-base(<base>, HEAD) → working tree`. This means
  a file with both committed-unpushed hunks and uncommitted hunks renders as
  one continuous diff.
- The unified diff is read-only. The diff toolbar's stage / unstage / revert
  controls are hidden when a unified-view file is selected.
- View-mode preference persists per task (same per-task settings store the
  existing list/tree toggle uses).

## Architecture

### Main process

`apps/emdash-desktop/src/main/core/git/`

- `impl/git-service.ts` — add:
  - `getUnifiedChangedFiles(base: GitObjectRef): Promise<Result<GitChange[], UnifiedDiffError>>`
    - Resolves `mergeBase = git merge-base <base> HEAD`.
    - Runs `git diff --name-status -M -C <mergeBase>` (no second ref → diffs
      against the working tree, including index and unstaged).
    - Maps the output into `GitChange[]` reusing existing parsing helpers.
    - Returns `err({ kind: 'no-merge-base', baseRef })` if `merge-base` fails.
  - `getUnifiedFileDiff(filePath: string, base: GitObjectRef): Promise<Result<string, ...>>`
    - Same merge-base resolution, then `git diff -M -C <mergeBase> -- <filePath>`.
- `controller.ts` — register two new RPC methods:
  - `git.getUnifiedChangedFiles(workspaceId, base)`
  - `git.getUnifiedFileDiff(workspaceId, filePath, base)`
- `workspace-git-provider.ts` — add the two methods to the provider interface.

### Shared types

`apps/emdash-desktop/src/shared/core/git/git.ts`

- Add `UnifiedDiffError` discriminated union:
  ```ts
  export type UnifiedDiffError =
    | { kind: 'no-merge-base'; baseRef: string }
    | { kind: 'base-unresolvable' }
    | { kind: 'too-many-files' };
  ```
- No new file-row type required — reuse `GitChange`. Layer attribution is not
  surfaced in the UI per Non-Goals.

### Renderer

`apps/emdash-desktop/src/renderer/features/tasks/diff-view/`

- `stores/git-store.ts`
  - Add `unifiedChanges: Resource<GitChange[]>`, with the same event
    subscriptions as `fullStatus` (head / index / fs-watch / local-refs).
    Reload triggers reuse the existing debounce values.
  - Add `unifiedBaseRef: GitObjectRef | null` computed from
    `prStore.activePullRequest?.baseRef ?? repositoryStore.defaultBranchRef`.
  - When `unifiedBaseRef` changes, `unifiedChanges` reloads.
- `stores/changes-view-store.ts`
  - Add `viewMode: 'split' | 'unified'` (observable).
  - Add `setViewMode(mode)`. Persisted via the existing per-task settings
    mechanism used for the list/tree toggle.
  - Mode change does not clear `unstagedSelection` / `stagedSelection`
    (split-mode selection state is independent of unified view).
- `stores/diff-selectors.ts` — add a selector that returns the unified file
  set merged with status iconography appropriate for the unified mode.
- `changes-panel/changes-panel.tsx`
  - Branch on `changesView.viewMode`:
    - `split`: existing `ResizablePanelGroup` (unchanged).
    - `unified`: render `<UnifiedSection />` filling the panel; keep
      `<GitStatusSection />` pinned at the bottom.
- `changes-panel/unified-section.tsx` — new. Renders a single
  `<ChangesListOrTree />` over `gitStore.unifiedChanges`. Handles loading,
  error, and empty states. No checkbox column (read-only).
- `changes-panel/components/changes-view-mode-toggle.tsx` — already exists
  for list/tree; add a sibling `view-mode-split-unified-toggle.tsx` placed in
  the same header. Both togglers stay visible together; "tree vs list"
  applies in either mode.
- `main-panel/diff-toolbar.tsx`
  - Accept a `mode: 'normal' | 'unified'` prop.
  - When `mode === 'unified'`, hide stage/unstage/revert and any commit-from-here
    controls. Keep navigation, copy-path, and view-mode controls.
- `main-panel/diff-view.tsx`
  - Accept a unified file selection (`{ kind: 'unified', path }`).
  - When unified, fetch via `rpc.git.getUnifiedFileDiff(workspaceId, path, baseRef)`.
  - Pass `mode='unified'` to the toolbar.

### Selection plumbing

The diff view's selection state already supports a tagged kind (disk / staged /
git / pr — see `expandForActiveFileType`). Add `unified` as a new tag and
route it to the unified data path.

## Data flow

1. User clicks the new Split/Unified toggle.
2. `changesViewStore.viewMode` flips. `ChangesPanel` re-renders.
3. `UnifiedSection` reads `gitStore.unifiedChanges`.
4. `unifiedChanges.Resource` is already subscribed to git/fs events; on first
   read it triggers a load via `rpc.git.getUnifiedChangedFiles(workspaceId, baseRef)`.
5. User clicks a row → `diffView.selectFile({ kind: 'unified', path })`.
6. Main panel calls `rpc.git.getUnifiedFileDiff(workspaceId, path, baseRef)`
   and renders the result with `mode='unified'`.
7. Any subsequent index, head, or fs change triggers a refresh through the
   existing event pipeline.

## Error handling

| Scenario | Source | UI |
|---|---|---|
| No PR and no default branch configured | renderer (computed `unifiedBaseRef === null`) | Empty state: "Configure a default branch to use this view." Link to project settings. |
| `merge-base` fails (orphan branch / no shared history) | main: `err({ kind: 'no-merge-base', baseRef })` | Inline error: "No common history with `<baseRef>`." |
| Too many files (reuse existing cap) | main: `err({ kind: 'too-many-files' })` | Existing `TOO_MANY_FILES_MSG` UI. |
| Single-file diff fetch fails | reuse `main-panel/missing-file-error.ts` | Existing missing-file UI. |
| Toggle race during refresh | n/a | Skeleton loader (same as split sections today). |

`Result<T, E>` is used for all new main-process returns, per `agents/conventions/main-patterns.md`.

## Testing

### Main process (vitest `node` project)

- `git-service.test.ts` — `getUnifiedChangedFiles`:
  - synthetic repo with (a) committed-unpushed only, (b) staged only,
    (c) unstaged only, (d) all three on the same file → expect one row per
    file with combined status.
  - rename and copy detection across the merge-base boundary.
  - orphan branch returns `no-merge-base`.
- `controller.test.ts` — RPC wiring; base-ref resolution.

### Renderer (vitest `node` project)

- `changes-view-store.test.ts` — `viewMode` toggle, persistence,
  no cross-contamination of `unstagedSelection` / `stagedSelection`.
- `git-store.test.ts` — `unifiedChanges` derived correctly; reloads when
  PR base or default branch changes.

### Renderer browser (vitest `browser` project)

- `unified-section.test.tsx` — list rendering, list↔tree toggle, file counts,
  empty state, error state, click-to-select wiring.
- `changes-panel.test.tsx` — split↔unified toggle keeps split-mode selection
  state intact across mode flips.

### Manual verification

- Open a task with an open PR.
- Modify file `A` in a committed-unpushed commit AND with extra uncommitted
  edits.
- Flip to Unified view → expect one row for `A`, status `M`, diff shows the
  full delta.
- Switch back to Split → confirm Unstaged and Staged selections preserved.

## Risks

1. **`merge-base` cost on large monorepos** — single call per refresh; should
   be a no-op compared to the existing status pipeline.
2. **Toggle UI clutter** — two toggles (list/tree, split/unified) live in the
   same header. Mitigated by placing them as a single togglegroup row.
3. **Read-only constraint surfacing** — users may try to right-click and stage
   from the unified view. Mitigation: make the read-only intent obvious by
   hiding rather than disabling the toolbar actions, and document in the
   toggle tooltip ("Read-only review of the full branch delta").
