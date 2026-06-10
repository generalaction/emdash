import { computed, makeObservable, reaction } from 'mobx';
import type { RepositoryStore } from '@renderer/features/projects/stores/repository-store';
import type { PrStore } from '@renderer/features/tasks/stores/pr-store';
import { events, rpc } from '@renderer/lib/ipc';
import { Resource } from '@renderer/lib/stores/resource';
import { fsWatchEventChannel } from '@shared/core/fs/fsEvents';
import {
  branchRef,
  commitRef,
  type GitChange,
  type GitObjectRef,
  refsEqual,
  remoteRef,
} from '@shared/core/git/git';
import { gitRefChangedChannel, gitWorkspaceChangedChannel } from '@shared/core/git/gitEvents';

/**
 * Resource of "unified changes": one row per file from the merge-base of
 * (PR base, or default branch) and HEAD all the way to the working tree.
 *
 * Backed by `git diff --name-status <merge-base>` (no second ref → vs working
 * tree). Refreshed on the same git/fs events as the normal status pipeline.
 */
export class UnifiedChangesStore {
  readonly changes: Resource<GitChange[]>;
  readonly mergeBase: Resource<string | null>;

  private readonly _disposeReactions: Array<() => void> = [];

  constructor(
    private readonly projectId: string,
    private readonly workspaceId: string,
    private readonly repositoryStore: RepositoryStore,
    private readonly prStore: PrStore
  ) {
    makeObservable(this, {
      baseRef: computed,
    });

    this.mergeBase = new Resource<string | null>(
      () => this._fetchMergeBase(),
      this._statusEventStrategies('merge-base')
    );

    this.changes = new Resource<GitChange[]>(
      () => this._fetchChanges(),
      this._statusEventStrategies('unified-changes')
    );

    // When the base ref changes, refetch.
    this._disposeReactions.push(
      reaction(
        () => {
          const ref = this.baseRef;
          return ref ? JSON.stringify(ref) : null;
        },
        () => {
          this.mergeBase.invalidate();
          this.changes.invalidate();
        }
      )
    );
  }

  /**
   * Resolved base ref: PR base if a PR exists for this task, else the project
   * default branch. Null when neither is configured.
   */
  get baseRef(): GitObjectRef | null {
    const pr = this.prStore.currentPr;
    if (pr) return remoteRef(this.repositoryStore.baseRemote, pr.baseRefName);
    const def = this.repositoryStore.defaultBranch;
    if (!def) return null;
    return branchRef(def);
  }

  start(): void {
    this.mergeBase.start();
    this.changes.start();
  }

  dispose(): void {
    for (const fn of this._disposeReactions) fn();
    this._disposeReactions.length = 0;
    this.mergeBase.dispose();
    this.changes.dispose();
  }

  private async _fetchMergeBase(): Promise<string | null> {
    const base = this.baseRef;
    if (!base) return null;
    const result = await rpc.workspace.git.getMergeBase(this.projectId, this.workspaceId, base);
    if (!result.success) return null;
    return result.data.sha;
  }

  private async _fetchChanges(): Promise<GitChange[]> {
    const base = this.baseRef;
    if (!base) return [];
    const mbResult = await rpc.workspace.git.getMergeBase(this.projectId, this.workspaceId, base);
    if (!mbResult.success || !mbResult.data.sha) return [];
    const result = await rpc.workspace.git.getChangedFiles(
      this.projectId,
      this.workspaceId,
      commitRef(mbResult.data.sha)
    );
    if (!result.success) return [];
    return result.data.changes;
  }

  /**
   * Same event strategies used by the normal status pipeline so unified
   * changes refresh in lock step with split-view sections.
   */
  private _statusEventStrategies(watchTag: string): Array<{
    kind: 'event';
    subscribe: (handler: () => void) => () => void;
    onEvent: 'reload';
    debounceMs: number;
  }> {
    const projectId = this.projectId;
    const workspaceId = this.workspaceId;
    return [
      {
        kind: 'event',
        subscribe: (handler) =>
          events.on(gitWorkspaceChangedChannel, (payload) => {
            if (payload.workspaceId === workspaceId && payload.kind === 'head') handler();
          }),
        onEvent: 'reload',
        debounceMs: 100,
      },
      {
        kind: 'event',
        subscribe: (handler) =>
          events.on(gitWorkspaceChangedChannel, (payload) => {
            if (payload.workspaceId === workspaceId && payload.kind === 'index') handler();
          }),
        onEvent: 'reload',
        debounceMs: 300,
      },
      {
        kind: 'event',
        subscribe: (handler) =>
          events.on(gitRefChangedChannel, (payload) => {
            if (payload.projectId !== projectId) return;
            if (payload.workspaceId !== undefined && payload.workspaceId !== workspaceId) return;
            // Reload on any local or remote ref change, since the base ref
            // (or the merge-base computation) can move with either.
            const baseRef = this.baseRef;
            if (!baseRef || baseRef.kind !== 'branch') {
              handler();
              return;
            }
            if (!payload.changedRefs || payload.changedRefs.some((r) => refsEqual(r, baseRef))) {
              handler();
            }
          }),
        onEvent: 'reload',
        debounceMs: 500,
      },
      {
        kind: 'event',
        subscribe: (handler) => {
          rpc.workspace.fs
            .watchSetPaths(projectId, workspaceId, [''], `unified-changes-${watchTag}`)
            .catch(() => {});
          const unsub = events.on(fsWatchEventChannel, (payload) => {
            if (payload.workspaceId !== workspaceId) return;
            const relevant = payload.events.some((e) => {
              if (e.path.startsWith('.git')) return false;
              if (e.oldPath?.startsWith('.git')) return false;
              return true;
            });
            if (relevant) handler();
          });
          return () => {
            unsub();
            rpc.workspace.fs
              .watchStop(projectId, workspaceId, `unified-changes-${watchTag}`)
              .catch(() => {});
          };
        },
        onEvent: 'reload',
        debounceMs: 500,
      },
    ];
  }
}
