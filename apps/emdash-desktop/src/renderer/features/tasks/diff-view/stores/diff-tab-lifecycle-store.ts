import { reaction } from 'mobx';
import type { PaneStore } from '@renderer/features/tabs/pane-store';
import { commitRef } from '@shared/core/git/utils';
import { getPrNumber } from '@shared/core/pull-requests/pull-requests';
import type { ActiveFile } from '@shared/view-state';
import type { GitWorktreeStore } from '../../stores/git-worktree-store';
import type { PrStore } from '../../stores/pr-store';
import type { DiffTabResource } from './diff-tab-resource';
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
    private readonly tabManager: PaneStore,
    private readonly gitWorktree: GitWorktreeStore,
    private readonly pr: PrStore,
    private readonly diffView: DiffViewStore
  ) {
    // Sync DiffViewStore.activeFile whenever the user activates a diff tab.
    this.disposers.push(
      reaction(
        () => this.tabManager.activeResourceOfKind<DiffTabResource>('diff') ?? null,
        (resource) => {
          if (resource) {
            const activeFile: ActiveFile = resource.toActiveFile();
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
          for (const r of this.tabManager.resourcesOfKind<DiffTabResource>('diff')) {
            if (r.diffGroup !== 'pr' || r.prNumber == null) continue;
            const matchedPr = this.pr.pullRequests.find((p) => getPrNumber(p) === r.prNumber);
            if (matchedPr) {
              for (const f of this.pr.getFiles(matchedPr).data ?? []) valid.add(`pr:${f.path}`);
            }
          }
          return valid;
        },
        (validKeys) => {
          const staleResources = this.tabManager
            .resourcesOfKind<DiffTabResource>('diff')
            .filter((r) => r.diffGroup !== 'git' && !validKeys.has(`${r.diffGroup}:${r.path}`));

          for (const resource of staleResources) {
            const counterpartGroup: 'disk' | 'staged' | null =
              resource.diffGroup === 'disk'
                ? 'staged'
                : resource.diffGroup === 'staged'
                  ? 'disk'
                  : null;

            if (counterpartGroup && validKeys.has(`${counterpartGroup}:${resource.path}`)) {
              const changes =
                counterpartGroup === 'staged'
                  ? this.gitWorktree.stagedFileChanges
                  : this.gitWorktree.unstagedFileChanges;
              const match = changes.find((c) => c.path === resource.path);
              resource.transition(counterpartGroup, commitRef('HEAD'), match?.status);
            } else {
              this.tabManager.closeTab(resource.tabId);
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
