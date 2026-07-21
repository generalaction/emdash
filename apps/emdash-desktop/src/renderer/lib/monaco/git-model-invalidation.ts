import { HEAD_REF, STAGED_REF, type GitRef } from '@shared/core/git/types';
import { commitRef } from '@shared/core/git/utils';
import type { MonacoModelRegistry } from './monaco-model-registry';

/**
 * Re-fetch the git models invalidated by a worktree update.
 *
 * On a `status` update only the staged snapshot changed. On any other update
 * (notably `head`, fired on commit or a branch switch in the same worktree) the
 * current HEAD moved, so every model that follows HEAD must be re-fetched.
 *
 * The diff view expresses "current HEAD" two ways — the `head` DiffMode
 * (`HEAD_REF`) and a commit ref pinned to the literal `'HEAD'`
 * (`commitRef('HEAD')`). They compare equal only within their own kind, so both
 * must be queried; otherwise a `commitRef('HEAD')` original keeps the previous
 * branch's content after a switch and the Changed diff shows stale changes.
 * See #2576.
 *
 * Pure (no event wiring) so it can be unit-tested without the renderer runtime.
 */
export function invalidateWorktreeGitModels(
  registry: MonacoModelRegistry,
  workspaceId: string,
  updateKind: string
): void {
  const refs: GitRef[] = updateKind === 'status' ? [STAGED_REF] : [HEAD_REF, commitRef('HEAD')];
  const invalidated = new Set<string>();
  for (const ref of refs) {
    for (const uri of registry.findGitUris({ workspaceId, ref })) {
      if (invalidated.has(uri)) continue;
      invalidated.add(uri);
      void registry.invalidateModel(uri);
    }
  }
}
