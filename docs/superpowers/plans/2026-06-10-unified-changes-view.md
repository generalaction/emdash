# Unified Changes View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Unified view-mode to `ChangesPanel` that shows one row per file for the full delta between the PR base (or default branch) and the working tree. Read-only.

**Architecture:** Add a new `unified` diff group, a `getUnifiedChangedFiles` RPC backed by `git diff --name-status` against `merge-base(<base>, HEAD)`, a `unifiedChanges` Resource on `GitStore`, and a `viewMode: 'split' | 'unified'` toggle on `ChangesViewStore`. The diff renderer treats `unified` like `disk` but with `merge-base` as the original ref instead of `STAGED_REF`.

**Tech Stack:** TypeScript, React, MobX, Electron, vitest, simple-git.

**Spec:** `docs/superpowers/specs/2026-06-10-unified-changes-view-design.md`

---

## File map

**New:**
- `apps/emdash-desktop/src/renderer/features/tasks/diff-view/changes-panel/unified-section.tsx`
- `apps/emdash-desktop/src/renderer/features/tasks/diff-view/changes-panel/components/split-unified-toggle.tsx`

**Modify:**
- `apps/emdash-desktop/src/main/core/git/impl/git-service.ts` — add `getUnifiedChangedFiles`, `getUnifiedDiffMergeBase`.
- `apps/emdash-desktop/src/main/core/git/workspace-git-provider.ts` — extend interface.
- `apps/emdash-desktop/src/main/core/git/controller.ts` — register RPC methods.
- `apps/emdash-desktop/src/shared/core/git/git.ts` — `UnifiedDiffError` type.
- `apps/emdash-desktop/src/main/core/settings/schema.ts` — add `unified` section to `changesViewModeSchema`, add `changesPanelMode` schema.
- `apps/emdash-desktop/src/renderer/features/tasks/diff-view/stores/git-store.ts` — `unifiedChanges` resource + `unifiedBaseRef` computed.
- `apps/emdash-desktop/src/renderer/features/tasks/diff-view/stores/changes-view-store.ts` — `panelMode` toggle.
- `apps/emdash-desktop/src/renderer/features/tasks/diff-view/changes-panel/changes-panel.tsx` — branch on panelMode.
- `apps/emdash-desktop/src/renderer/features/tasks/tabs/diff-tab-store.ts` — add `'unified'` to `diffGroup`, store `mergeBaseRef`.
- `apps/emdash-desktop/src/renderer/features/tasks/tabs/tab-manager-store.ts` — add `'unified'` to type, add `openUnifiedDiff` opener.
- `apps/emdash-desktop/src/renderer/features/tasks/diff-view/main-panel/diff-file-renderer.tsx` — handle `'unified'` (orig=mergeBase ref, mod=working tree buffer).
- `apps/emdash-desktop/src/renderer/features/tasks/diff-view/main-panel/diff-toolbar.tsx` — hide stage/unstage when `diffGroup === 'unified'`.
- `apps/emdash-desktop/src/renderer/features/tasks/diff-view/stores/diff-tab-lifecycle-store.ts` — accept `'unified'` tabs.

---

## Task 1: Backend — `getUnifiedChangedFiles` RPC

**Files:**
- Modify: `apps/emdash-desktop/src/main/core/git/impl/git-service.ts`
- Modify: `apps/emdash-desktop/src/main/core/git/workspace-git-provider.ts`
- Modify: `apps/emdash-desktop/src/main/core/git/controller.ts`
- Modify: `apps/emdash-desktop/src/shared/core/git/git.ts`
- Test: `apps/emdash-desktop/src/main/core/git/impl/git-service.test.ts` (add tests)

- [ ] **Step 1.1**: Add `UnifiedDiffError` to `git.ts`:

```ts
export type UnifiedDiffError =
  | { kind: 'no-merge-base'; baseRef: string }
  | { kind: 'base-unresolvable' };
```

- [ ] **Step 1.2**: Add to `WorkspaceGitProvider` interface:

```ts
getUnifiedChangedFiles(base: GitObjectRef): Promise<Result<GitChange[], UnifiedDiffError>>;
getUnifiedMergeBase(base: GitObjectRef): Promise<Result<string, UnifiedDiffError>>;
```

- [ ] **Step 1.3**: Implement in `git-service.ts`:

```ts
async getUnifiedChangedFiles(base: GitObjectRef): Promise<Result<GitChange[], UnifiedDiffError>> {
  const baseStr = toRefString(base);
  const mb = await this._mergeBase(baseStr).catch(() => null);
  if (!mb) return err({ kind: 'no-merge-base', baseRef: baseStr });
  // git diff --name-status -M -C <mb>  (no second ref → vs working tree)
  const raw = await this.git.raw(['diff', '--name-status', '-M', '-C', mb]);
  return ok(parseNameStatus(raw));
}

async getUnifiedMergeBase(base: GitObjectRef): Promise<Result<string, UnifiedDiffError>> {
  const baseStr = toRefString(base);
  const mb = await this._mergeBase(baseStr).catch(() => null);
  if (!mb) return err({ kind: 'no-merge-base', baseRef: baseStr });
  return ok(mb);
}

private async _mergeBase(baseStr: string): Promise<string> {
  const out = await this.git.raw(['merge-base', baseStr, 'HEAD']);
  return out.trim();
}
```

(Reuse the existing name-status parsing helper if present, otherwise add a small `parseNameStatus` next to the existing parsers — same style as `getChangedFiles`.)

- [ ] **Step 1.4**: Register RPC in `controller.ts` (mirror existing `getChangedFiles` controller method):

```ts
getUnifiedChangedFiles: async (
  projectId: string,
  workspaceId: string,
  base: GitObjectRef
): Promise<Result<GitChange[], UnifiedDiffError>> => {
  const env = await this.acquire(projectId, workspaceId);
  if (!env.ok) return env;
  return env.value.git.getUnifiedChangedFiles(base);
},
getUnifiedMergeBase: async (
  projectId: string,
  workspaceId: string,
  base: GitObjectRef
): Promise<Result<string, UnifiedDiffError>> => {
  const env = await this.acquire(projectId, workspaceId);
  if (!env.ok) return env;
  return env.value.git.getUnifiedMergeBase(base);
},
```

- [ ] **Step 1.5**: Add tests in `git-service.test.ts` covering:
  - committed-unpushed only on the branch
  - staged only
  - unstaged only
  - all three on same path
  - rename via `-M`
  - orphan branch returns `no-merge-base`

Use the existing temp-repo helpers (look for `createTempGitRepo` or similar in `git-service.test.ts`).

- [ ] **Step 1.6**: Run tests:

```bash
pnpm vitest run apps/emdash-desktop/src/main/core/git/impl/git-service.test.ts
```

Expected: all new tests pass; existing tests unaffected.

- [ ] **Step 1.7**: Commit:

```bash
git add apps/emdash-desktop/src/main/core/git/ apps/emdash-desktop/src/shared/core/git/git.ts
git commit -m "feat(git): add getUnifiedChangedFiles RPC for unified diff base..working tree"
```

---

## Task 2: Settings schema — persist panel view mode

**Files:**
- Modify: `apps/emdash-desktop/src/main/core/settings/schema.ts`

- [ ] **Step 2.1**: Add a new schema entry next to `changesViewModeSchema`:

```ts
export const changesPanelModeSchema = z.enum(['split', 'unified']);
```

- [ ] **Step 2.2**: Register it on the per-task settings (search for where the existing `changesViewMode` is registered in app settings — `appSettingsSchema` and the persistence layer):

```ts
changesPanelMode: changesPanelModeSchema.default('split'),
```

- [ ] **Step 2.3**: Run typecheck:

```bash
pnpm run typecheck
```

Expected: pass.

- [ ] **Step 2.4**: Commit:

```bash
git add apps/emdash-desktop/src/main/core/settings/schema.ts
git commit -m "feat(settings): add changesPanelMode persisted setting (split | unified)"
```

---

## Task 3: GitStore — `unifiedChanges` Resource and `unifiedBaseRef`

**Files:**
- Modify: `apps/emdash-desktop/src/renderer/features/tasks/diff-view/stores/git-store.ts`
- Test: `apps/emdash-desktop/src/renderer/features/tasks/diff-view/stores/git-store.test.ts` (add tests)

- [ ] **Step 3.1**: Add `unifiedBaseRef` and `unifiedMergeBase` computeds:

```ts
get unifiedBaseRef(): GitObjectRef | null {
  const prBase = this.prStore.currentPr;
  if (prBase) return remoteRef(this.repositoryStore.baseRemote, prBase.baseRefName);
  const def = this.repositoryStore.defaultBranch;
  if (!def) return null;
  return def.type === 'remote'
    ? remoteRef(def.remote, def.branch)
    : localRef(def.branch);
}
```

(Follow the same pattern `pr-store.ts` uses for `remoteRef(this.repositoryStore.baseRemote, pr.baseRefName)`.)

- [ ] **Step 3.2**: Inject `prStore` into `GitStore` constructor (currently it doesn't receive it). Update the call sites that construct `GitStore` to pass it. If `prStore` and `gitStore` have a circular construction concern, alternatively add `unifiedBaseRef` as a method that takes `prStore` as a parameter and let the section component pass it in. Pick whichever is cleaner after grepping for `new GitStore(`.

- [ ] **Step 3.3**: Add `unifiedChanges: Resource<GitChange[]>`:

```ts
this.unifiedChanges = new Resource<GitChange[]>(
  () => this._fetchUnifiedChanges(),
  // Reuse the same event subscriptions as fullStatus (head, index, fs, refs).
  this._buildStatusEventSpecs()
);
```

Plus `_fetchUnifiedChanges`:

```ts
private async _fetchUnifiedChanges(): Promise<GitChange[]> {
  const base = this.unifiedBaseRef;
  if (!base) return [];
  const result = await rpc.git.getUnifiedChangedFiles(this.projectId, this.workspaceId, base);
  if (!result.ok) {
    if (result.error.kind === 'no-merge-base') {
      throw new Error(`No common history with ${result.error.baseRef}`);
    }
    throw new Error('Failed to load unified changes');
  }
  return result.value;
}
```

Reload the resource when `unifiedBaseRef` changes (use a `mobx.reaction` in the constructor).

- [ ] **Step 3.4**: Add tests:

```ts
it('emits empty list when no base ref configured', async () => { ... });
it('reloads when PR base changes', async () => { ... });
it('surfaces no-merge-base errors', async () => { ... });
```

- [ ] **Step 3.5**: Run tests:

```bash
pnpm vitest run apps/emdash-desktop/src/renderer/features/tasks/diff-view/stores/git-store.test.ts
```

- [ ] **Step 3.6**: Commit:

```bash
git add apps/emdash-desktop/src/renderer/features/tasks/diff-view/stores/git-store.ts apps/emdash-desktop/src/renderer/features/tasks/diff-view/stores/git-store.test.ts
git commit -m "feat(diff-view): add unifiedChanges resource to GitStore"
```

---

## Task 4: ChangesViewStore — panel mode

**Files:**
- Modify: `apps/emdash-desktop/src/renderer/features/tasks/diff-view/stores/changes-view-store.ts`
- Test: `apps/emdash-desktop/src/renderer/features/tasks/diff-view/stores/changes-view-store.test.ts` (add tests)

- [ ] **Step 4.1**: Extend `ChangesViewStore` with `panelMode`:

```ts
panelMode: 'split' | 'unified' = 'split';

setPanelMode(mode: 'split' | 'unified'): void {
  runInAction(() => { this.panelMode = mode; });
}
```

Add to `makeObservable` definitions.

- [ ] **Step 4.2**: Add a getter `unifiedFileChanges` that returns `gitStore.unifiedChanges.data ?? []` for convenience.

- [ ] **Step 4.3**: Persist via the existing per-task settings hook (same mechanism as `useChangesViewMode`). The hook layer (`use-panel-mode.ts`) lives in `changes-panel/hooks/`:

Create `apps/emdash-desktop/src/renderer/features/tasks/diff-view/changes-panel/hooks/use-panel-mode.ts`:

```ts
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';

export function usePanelMode() {
  const { value, update } = useAppSettingsKey('changesPanelMode');
  const mode = value ?? 'split';
  const setMode = (next: 'split' | 'unified') => update(next);
  return { mode, setMode };
}
```

(Verify the `useAppSettingsKey` API for non-object settings; if it requires object semantics, wrap.)

- [ ] **Step 4.4**: Tests:

```ts
it('toggles panelMode independently of selections', () => { ... });
```

- [ ] **Step 4.5**: Commit:

```bash
git add apps/emdash-desktop/src/renderer/features/tasks/diff-view/stores/changes-view-store.ts apps/emdash-desktop/src/renderer/features/tasks/diff-view/stores/changes-view-store.test.ts apps/emdash-desktop/src/renderer/features/tasks/diff-view/changes-panel/hooks/use-panel-mode.ts
git commit -m "feat(diff-view): add panelMode (split | unified) to ChangesViewStore"
```

---

## Task 5: New `unified` diff group plumbing

**Files:**
- Modify: `apps/emdash-desktop/src/renderer/features/tasks/tabs/diff-tab-store.ts`
- Modify: `apps/emdash-desktop/src/renderer/features/tasks/tabs/tab-manager-store.ts`
- Modify: `apps/emdash-desktop/src/renderer/features/tasks/diff-view/main-panel/diff-file-renderer.tsx`
- Modify: `apps/emdash-desktop/src/renderer/features/tasks/diff-view/stores/diff-tab-lifecycle-store.ts`

- [ ] **Step 5.1**: Add `'unified'` to the `diffGroup` union in `diff-tab-store.ts`:

```ts
diffGroup: 'disk' | 'staged' | 'git' | 'pr' | 'unified';
```

Persist `mergeBaseRef: GitObjectRef` for unified tabs (alongside `originalRef`).

- [ ] **Step 5.2**: Same change in `tab-manager-store.ts:120` and `:388/:446` serialization. Add an `openUnifiedDiff(activeFile, status, mergeBaseRef)` opener mirroring `openDiff`/`openDiffPreview` for the staged group.

- [ ] **Step 5.3**: In `diff-file-renderer.tsx`, extend the URI logic:

```ts
const originalUri = (() => {
  if (tab.diffGroup === 'disk') return modelRegistry.toGitUri(uri, STAGED_REF);
  if (tab.diffGroup === 'unified') return modelRegistry.toGitUri(uri, tab.originalRef);
  if (tab.diffGroup === 'git' || tab.diffGroup === 'pr') return modelRegistry.toGitUri(uri, tab.originalRef);
  return modelRegistry.toGitUri(uri, HEAD_REF);
})();

const modifiedUri = (() => {
  if (tab.diffGroup === 'staged') return modelRegistry.toGitUri(uri, STAGED_REF);
  if (tab.diffGroup === 'pr') return modelRegistry.toGitUri(uri, tab.modifiedRef ?? HEAD_REF);
  if (tab.diffGroup === 'git') return modelRegistry.toGitUri(uri, tab.modifiedRef ?? HEAD_REF);
  // disk and unified: working-tree buffer
  return uri;
})();
```

In the `useEffect` model-registration block, add a branch for `unified` that registers (a) original = git ref `tab.originalRef`, (b) modified = `'buffer'` (mirroring the `disk` flow but without `STAGED_REF`).

- [ ] **Step 5.4**: In `diff-tab-lifecycle-store.ts`, add `'unified'` to validation paths so unified tabs aren't pruned. Treat unified tabs as ephemeral (close when leaving unified mode is acceptable, or keep them — pick whichever matches existing behavior for `disk` tabs).

- [ ] **Step 5.5**: Run typecheck and unit tests:

```bash
pnpm run typecheck
pnpm vitest run apps/emdash-desktop/src/renderer/features/tasks
```

- [ ] **Step 5.6**: Commit:

```bash
git add apps/emdash-desktop/src/renderer/features/tasks/tabs apps/emdash-desktop/src/renderer/features/tasks/diff-view/main-panel/diff-file-renderer.tsx apps/emdash-desktop/src/renderer/features/tasks/diff-view/stores/diff-tab-lifecycle-store.ts
git commit -m "feat(diff-view): add 'unified' diff group plumbing (working tree vs merge-base)"
```

---

## Task 6: `UnifiedSection` UI

**Files:**
- Create: `apps/emdash-desktop/src/renderer/features/tasks/diff-view/changes-panel/unified-section.tsx`

- [ ] **Step 6.1**: Implement `UnifiedSection` modeled on `staged-section.tsx`, omitting all stage/unstage/commit affordances:

```tsx
export const UnifiedSection = observer(function UnifiedSection() {
  const { projectId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const taskView = useWorkspaceViewModel();
  const workspace = useWorkspace();
  const git = workspace.git;
  const diffView = taskView.diffView;
  if (!diffView) return null;

  const { mode: viewMode, setMode: setViewMode } = useChangesViewMode('unified');
  const changes = git.unifiedChanges.data ?? [];
  const hasChanges = changes.length > 0;
  const isLoading = git.unifiedChanges.isLoading;
  const error = git.unifiedChanges.error;

  const activePath =
    taskView.tabManager.activeDescriptor?.kind === 'diff' &&
    taskView.tabManager.activeDescriptor.diffGroup === 'unified'
      ? taskView.tabManager.activeDescriptor.path
      : undefined;

  const handleSelect = async (change: GitChange) => {
    const baseRef = git.unifiedBaseRef;
    if (!baseRef) return;
    const mb = await rpc.git.getUnifiedMergeBase(projectId, workspaceId, baseRef);
    if (!mb.ok) return;
    taskView.tabManager.openUnifiedDiff(
      { path: change.path, type: 'unified', group: 'unified', originalRef: commitRef(mb.value) },
      change.status
    );
  };

  return (
    <>
      <SectionHeader
        label="All changes"
        count={changes.length}
        actions={<ChangesViewModeToggle value={viewMode} onChange={setViewMode} label="Unified" />}
      />
      {error && <EmptyState label="Cannot load unified diff" description={error.message} />}
      {!error && !isLoading && !hasChanges && (
        <EmptyState label="No changes" description="Nothing differs from the base branch." />
      )}
      <div className="min-h-0 flex-1 px-1">
        <ChangesListOrTree
          viewMode={viewMode}
          changes={changes}
          isSelected={() => false}
          onToggleSelect={() => {}}
          activePath={activePath}
          onSelectChange={(c) => void handleSelect(c)}
          onDoubleClickChange={(c) => void handleSelect(c)}
        />
      </div>
    </>
  );
});
```

(Adjust prop names to match the actual `ChangesListOrTree` API. Some checkbox-related props may need to be made optional in the component or replaced with no-ops.)

- [ ] **Step 6.2**: If `ChangesListOrTree` requires a checkbox column, add an optional `selectionDisabled` prop that hides selection UI; thread through to `VirtualizedChangesList` and `VirtualizedChangesTree`.

- [ ] **Step 6.3**: Extend the `changesViewModeSchema` in `apps/emdash-desktop/src/main/core/settings/schema.ts` to include `unified: z.enum(['flat', 'tree'])`.

- [ ] **Step 6.4**: Commit:

```bash
git add apps/emdash-desktop/src/renderer/features/tasks/diff-view/changes-panel/unified-section.tsx apps/emdash-desktop/src/main/core/settings/schema.ts
git commit -m "feat(diff-view): add UnifiedSection rendering all changes vs base"
```

---

## Task 7: Split/Unified toggle and `ChangesPanel` branching

**Files:**
- Create: `apps/emdash-desktop/src/renderer/features/tasks/diff-view/changes-panel/components/split-unified-toggle.tsx`
- Modify: `apps/emdash-desktop/src/renderer/features/tasks/diff-view/changes-panel/changes-panel.tsx`

- [ ] **Step 7.1**: Create the toggle component (mirrors `changes-view-mode-toggle.tsx`):

```tsx
import { Layers, Rows3 } from 'lucide-react';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

interface Props {
  value: 'split' | 'unified';
  onChange: (mode: 'split' | 'unified') => void;
}

export function SplitUnifiedToggle({ value, onChange }: Props) {
  const next = value === 'split' ? 'unified' : 'split';
  const Icon = value === 'split' ? Layers : Rows3;
  const tooltip = value === 'split' ? 'Switch to unified view' : 'Switch to split view';
  return (
    <Tooltip>
      <TooltipTrigger>
        <Button variant="ghost" size="icon-xs" onClick={() => onChange(next)} aria-label={tooltip}>
          <Icon className="size-3" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
```

- [ ] **Step 7.2**: Refactor `changes-panel.tsx` to branch on `panelMode`:

```tsx
const { mode: panelMode, setMode: setPanelMode } = usePanelMode();

if (!diffView || !changesView || !workspace.git.hasData) return null;

return (
  <div className="flex h-full flex-col">
    <div className="flex items-center justify-end px-2 py-1 border-b border-border">
      <SplitUnifiedToggle value={panelMode} onChange={setPanelMode} />
    </div>
    {panelMode === 'split' ? (
      // existing ResizablePanelGroup
    ) : (
      <UnifiedSection />
    )}
    <GitStatusSection />
  </div>
);
```

- [ ] **Step 7.3**: Run dev to spot-check (manual):

```bash
pnpm run d
```

Verify:
- Toggle visible at the top of the changes panel.
- Split mode unchanged.
- Unified mode shows one list, populated by changes vs base.
- Click a file in unified mode → opens a diff that respects unified semantics.

- [ ] **Step 7.4**: Commit:

```bash
git add apps/emdash-desktop/src/renderer/features/tasks/diff-view/changes-panel/
git commit -m "feat(diff-view): wire split/unified panel toggle"
```

---

## Task 8: Toolbar — hide stage/unstage in unified mode

**Files:**
- Modify: `apps/emdash-desktop/src/renderer/features/tasks/diff-view/main-panel/diff-toolbar.tsx`

- [ ] **Step 8.1**: At each stage/unstage/revert button render, gate on `tab.diffGroup !== 'unified'`. Keep navigation, copy-path, and view controls visible.

- [ ] **Step 8.2**: Manual verification: open a file in unified mode → toolbar shows no stage/unstage actions.

- [ ] **Step 8.3**: Commit:

```bash
git add apps/emdash-desktop/src/renderer/features/tasks/diff-view/main-panel/diff-toolbar.tsx
git commit -m "feat(diff-view): hide stage/unstage actions in unified diff toolbar"
```

---

## Task 9: Local merge gate

- [ ] **Step 9.1**: Run the full local merge gate:

```bash
pnpm run format
pnpm run lint
pnpm run typecheck
pnpm run test
```

Fix any failures inline, commit fixes as separate commits with descriptive messages.

- [ ] **Step 9.2**: Final commit if any fixups happened.

---

## Self-review checklist (run after writing all tasks)

- [x] Each spec section maps to a task: backend RPC (Task 1), settings (Task 2), GitStore (Task 3), ChangesViewStore (Task 4), diff group (Task 5), UI (Tasks 6/7), toolbar (Task 8), gate (Task 9).
- [x] No "TBD" or "TODO".
- [x] Type names consistent: `panelMode`, `'split' | 'unified'`, `unifiedChanges`, `unifiedBaseRef` used throughout.
- [x] All file paths absolute under `apps/emdash-desktop/...`.
- [x] Backend tests in Task 1 cover all four scenarios from the spec's testing section.

