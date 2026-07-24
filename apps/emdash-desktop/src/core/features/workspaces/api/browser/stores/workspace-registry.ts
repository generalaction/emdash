import { observable } from 'mobx';
import { WorkspaceStore } from '@core/features/workspaces/api/browser/stores/workspace';
import type { WorkspaceScopedStoreContext } from '@core/features/workspaces/contributions/browser/workspace-stores';
import type { WorkspaceResolution } from '@core/primitives/workspaces/api';

export type WorkspaceBootstrapState =
  | { kind: 'pending' }
  | { kind: 'resolving' }
  | { kind: 'needs-resolution'; resolution: WorkspaceResolution }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

type WorkspaceRegistryEntry = {
  store: WorkspaceStore;
  refCount: number;
  activated: boolean;
};

export class WorkspaceRegistryStore {
  private readonly entries = new Map<string, WorkspaceRegistryEntry>();
  /** Observable map of workspace bootstrap states, keyed by workspaceId. */
  private readonly bootstrapStates = observable.map<string, WorkspaceBootstrapState>();

  acquire(context: WorkspaceScopedStoreContext): WorkspaceStore {
    const existing = this.entries.get(context.workspaceId);
    if (existing) {
      existing.refCount += 1;
      return existing.store;
    }

    const store = new WorkspaceStore(context);
    this.entries.set(context.workspaceId, { store, refCount: 1, activated: false });
    return store;
  }

  get(workspaceId: string): WorkspaceStore | undefined {
    return this.entries.get(workspaceId)?.store;
  }

  activate(workspaceId: string): void {
    const entry = this.entries.get(workspaceId);
    if (!entry || entry.activated) {
      return;
    }
    entry.activated = true;
    entry.store.activate();
  }

  release(workspaceId: string): void {
    const entry = this.entries.get(workspaceId);
    if (!entry) {
      return;
    }

    entry.refCount -= 1;

    if (entry.refCount <= 0) {
      entry.store.dispose();
      this.entries.delete(workspaceId);
      this.bootstrapStates.delete(workspaceId);
    }
  }

  // -------------------------------------------------------------------------
  // Bootstrap state
  // -------------------------------------------------------------------------

  setBootstrapState(workspaceId: string, state: WorkspaceBootstrapState): void {
    this.bootstrapStates.set(workspaceId, state);
  }

  bootstrapStateFor(workspaceId: string): WorkspaceBootstrapState | undefined {
    return this.bootstrapStates.get(workspaceId);
  }
}

export const workspaceRegistry = new WorkspaceRegistryStore();
