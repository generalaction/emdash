import { action, makeObservable, observable, reaction } from 'mobx';
import type { DiffViewStore } from '@core/features/source-control/api/browser/diff-view/stores/diff-view-store';
import type { PrStore } from '@core/features/source-control/api/browser/stores/pr-store';
import { gitCheckoutStoreToken } from '@core/features/source-control/contributions/browser/workspace-store-tokens';
import { commitRef } from '@core/primitives/git/api';
import type { TabResource } from '@core/primitives/workbench-shell/browser/tabs/core/tab-provider';
import { getPrNumber } from '@core/services/pull-requests/api';
import type { GitCheckoutStore } from '../../stores/git-checkout-store';
import { DiffTabResource } from './diff-tab-resource';

interface DiffSession {
  gitCheckout: GitCheckoutStore;
  pr: PrStore;
  diffView: DiffViewStore;
}

/**
 * Persistent, task-scoped manager for diff tab resources.
 *
 * Replaces DiffTabLifecycleStore. Manages two concerns:
 *
 * 1. **acquire/release** — tracks the live set of DiffTabResources. Resources call
 *    acquire() in their constructor and release() in dispose(). Because restored diff
 *    tabs are constructed during hydrate() (before initialize()), the manager must
 *    exist before the git/PR session is available.
 *
 * 2. **session binding** — bindSession() starts the git-staleness reaction once a
 *    workspace session is available; unbindSession() tears it down on suspend().
 *
 * activeFile sync is owned by DiffTabResource.onActivate(), which reads the current
 * diffView from currentDiffView() — only non-null while a session is bound.
 */
export class DiffTabManager {
  private readonly _resources = observable.set<DiffTabResource>([], { deep: false });
  private _session: DiffSession | null = null;
  private _staleDisposer: (() => void) | null = null;

  constructor() {
    makeObservable<DiffTabManager, '_session'>(this, {
      _session: observable.ref,
      acquire: action,
      release: action,
      bindSession: action,
      unbindSession: action,
    });
  }

  acquire(resource: DiffTabResource): void {
    if (this._resources.has(resource)) return;
    this._resources.add(resource);
    this._session?.diffView.retainWorkspace(resource.workspaceId);
  }

  release(resource: DiffTabResource): void {
    if (!this._resources.delete(resource)) return;
    this._session?.diffView.releaseWorkspace(resource.workspaceId);
  }

  /** Returns the bound diffView, or null between sessions. Used by onActivate(). */
  currentDiffView(): DiffViewStore | null {
    return this._session?.diffView ?? null;
  }

  bindResources(resources: Iterable<TabResource>): void {
    for (const resource of resources) {
      if (resource instanceof DiffTabResource) resource.bindManager(this);
    }
  }

  /**
   * Bind git/PR/diffView references and start the staleness reaction.
   * Safe to call again after unbindSession() (e.g. task re-provision).
   */
  bindSession(session: DiffSession): void {
    this.unbindSession();
    this._session = session;
    for (const resource of this._resources) session.diffView.retainWorkspace(resource.workspaceId);
    this._staleDisposer = reaction(
      () => this._validKeys(session),
      (validKeys) => this._reconcile(session, validKeys),
      { equals: (a, b) => a.size === b.size && [...a].every((k) => b.has(k)) }
    );
  }

  /** Dispose the staleness reaction and clear the session reference. */
  unbindSession(): void {
    this._staleDisposer?.();
    this._staleDisposer = null;
    for (const resource of this._resources)
      this._session?.diffView.releaseWorkspace(resource.workspaceId);
    this._session = null;
  }

  /** Full teardown — call only when the task is permanently removed. */
  dispose(): void {
    this.unbindSession();
    this._resources.clear();
  }

  private _validKeys(session: DiffSession): Set<string> {
    const valid = new Set<string>();
    const scannedWorkspaces = new Set<string>();
    for (const r of this._resources) {
      const workspace = session.diffView.workspaceFor(r.workspaceId);
      const git = workspace?.get(gitCheckoutStoreToken);
      if (!git || git.isLoading || git.error) {
        // Keep tabs through loading, unavailable checkouts, and transient Git failures.
        valid.add(`${r.workspaceId}:${r.diffGroup}:${r.path}`);
        continue;
      }
      if (!scannedWorkspaces.has(r.workspaceId)) {
        scannedWorkspaces.add(r.workspaceId);
        for (const c of git.unstagedFileChanges) valid.add(`${r.workspaceId}:disk:${c.path}`);
        for (const c of git.stagedFileChanges) valid.add(`${r.workspaceId}:staged:${c.path}`);
      }
      if (r.diffGroup !== 'pr' || r.prNumber == null) continue;
      const matchedPr = session.pr.pullRequests.find((p) => getPrNumber(p) === r.prNumber);
      if (matchedPr) {
        for (const f of session.pr.getFiles(matchedPr).data ?? [])
          valid.add(`${r.workspaceId}:pr:${f.path}`);
      }
    }
    return valid;
  }

  private _reconcile(session: DiffSession, validKeys: Set<string>): void {
    const stale = [...this._resources].filter(
      (r) => r.diffGroup !== 'git' && !validKeys.has(`${r.workspaceId}:${r.diffGroup}:${r.path}`)
    );

    for (const resource of stale) {
      const counterpartGroup: 'disk' | 'staged' | null =
        resource.diffGroup === 'disk' ? 'staged' : resource.diffGroup === 'staged' ? 'disk' : null;

      if (
        counterpartGroup &&
        validKeys.has(`${resource.workspaceId}:${counterpartGroup}:${resource.path}`)
      ) {
        const git = session.diffView.workspaceFor(resource.workspaceId)?.get(gitCheckoutStoreToken);
        if (!git) continue;
        const changes =
          counterpartGroup === 'staged' ? git.stagedFileChanges : git.unstagedFileChanges;
        const match = changes.find((c) => c.path === resource.path);
        resource.transition(counterpartGroup, commitRef('HEAD'), match?.status);
      } else {
        // Force-close (no user confirmation needed for auto-close on git state change).
        resource.closeSelf();
      }
    }
  }
}
