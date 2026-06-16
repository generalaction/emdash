import { reaction } from 'mobx';
import type { DiffTabStore } from '@renderer/features/tasks/tabs/diff-tab-store';
import type { TabManagerStore } from '@renderer/features/tasks/tabs/tab-manager-store';
import { commitRef } from '@shared/core/git/utils';
import { getPrNumber } from '@shared/core/pull-requests/pull-requests';
import type { ActiveFile } from '@shared/view-state';
import type { GitWorktreeStore } from '../../stores/git-worktree-store';
import type { PrStore } from '../../stores/pr-store';
import type { DiffViewStore } from './diff-view-store';

/**
 * Owns lifecycle reactions for diff tabs:
 *  - Syncs DiffViewStore.activeFile when the user activates a diff tab.
 *  - Auto-closes or transitions stale diff tabs when git file lists change.
 *
 * Extracted from TaskViewStore to keep diff domain logic self-contained.
 * Session-scoped: created in WorkspaceViewModel.initialize(), disposed in suspend(),
 * so the workspace is always live while this store exists — no null guards needed.
 */
export class DiffTabLifecycleStore {
  private readonly disposers: (() => void)[] = [];

  constructor(
    private readonly tabManager: TabManagerStore,
    private readonly gitWorktree: GitWorktreeStore,
    private readonly pr: PrStore,
    private readonly diffView: DiffViewStore
  ) {
    // Sync DiffViewStore.activeFile whenever the user activates a diff tab.
    this.disposers.push(
      reaction(
        () => {
          const desc = this.tabManager.activeDescriptor;
          return desc?.kind === 'diff' ? desc : null;
        },
        (tab) => {
          if (tab) {
            const activeFile: ActiveFile = {
              path: tab.path,
              type: tab.diffGroup === 'disk' ? 'disk' : 'git',
              group: tab.diffGroup,
              originalRef: tab.originalRef,
              modifiedRef: tab.modifiedRef,
              prNumber: tab.prNumber,
              prBaseOid: tab.prBaseOid,
              prHeadOid: tab.prHeadOid,
              commitOriginalSha: tab.commitOriginalSha,
              commitModifiedSha: tab.commitModifiedSha,
            };
            this.diffView.setActiveFile(activeFile);
          }
        }
      )
    );

    // Auto-close diff tabs whose file is no longer present in the corresponding
    // git category. 'git' tabs compare arbitrary fixed refs and are never auto-closed.
    this.disposers.push(
      reaction(
        () => {
          const valid = new Set<string>();
          for (const c of this.gitWorktree.unstagedFileChanges) valid.add(`disk:${c.path}`);
          for (const c of this.gitWorktree.stagedFileChanges) valid.add(`staged:${c.path}`);
          for (const id of this.tabManager.tabOrder) {
            const t = this.tabManager.entries.get(id);
            if (!t || t.kind !== 'diff' || t.diffGroup !== 'pr' || t.prNumber == null) continue;
            const matchedPr = this.pr.pullRequests.find((p) => getPrNumber(p) === t.prNumber);
            if (matchedPr) {
              for (const f of this.pr.getFiles(matchedPr).data ?? []) valid.add(`pr:${f.path}`);
            }
          }
          return valid;
        },
        (validKeys) => {
          const stale = [...this.tabManager.tabOrder]
            .map((id) => this.tabManager.entries.get(id))
            .filter(
              (t): t is DiffTabStore =>
                t !== undefined &&
                t.kind === 'diff' &&
                t.diffGroup !== 'git' &&
                !validKeys.has(`${t.diffGroup}:${t.path}`)
            );

          for (const tab of stale) {
            const counterpartGroup: 'disk' | 'staged' | null =
              tab.diffGroup === 'disk' ? 'staged' : tab.diffGroup === 'staged' ? 'disk' : null;

            if (counterpartGroup && validKeys.has(`${counterpartGroup}:${tab.path}`)) {
              const changes =
                counterpartGroup === 'staged'
                  ? this.gitWorktree.stagedFileChanges
                  : this.gitWorktree.unstagedFileChanges;
              const match = changes.find((c) => c.path === tab.path);
              this.tabManager.transitionDiffTab(
                tab.tabId,
                counterpartGroup,
                commitRef('HEAD'),
                match?.status
              );
            } else {
              this.tabManager.closeTab(tab.tabId);
            }
          }
        },
        { equals: (a, b) => a.size === b.size && [...a].every((k) => b.has(k)) }
      )
    );
  }

  dispose(): void {
    for (const d of this.disposers) d();
  }
}
