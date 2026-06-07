import { observable } from 'mobx';
import type { ProjectSettingsStore } from '@renderer/features/projects/stores/project-settings-store';
import type { WorkspaceResolution } from '@shared/core/workspaces/workspaces';
import { WorkspaceStore } from './workspace';

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

function makeKey(projectId: string, workspaceId: string): string {
  return `${projectId}::${workspaceId}`;
}

export class WorkspaceRegistryStore {
  private readonly entries = new Map<string, WorkspaceRegistryEntry>();
  /** Observable map of workspace bootstrap states, keyed by projectId::workspaceId. */
  private readonly bootstrapStates = observable.map<string, WorkspaceBootstrapState>();

  acquire(
    projectId: string,
    workspaceId: string,
    path: string,
    settingsStore: ProjectSettingsStore,
    baseRef: string,
    sshConnectionId?: string
  ): WorkspaceStore {
    const key = makeKey(projectId, workspaceId);
    const existing = this.entries.get(key);
    if (existing) {
      existing.refCount += 1;
      return existing.store;
    }

    const store = new WorkspaceStore(
      projectId,
      workspaceId,
      path,
      settingsStore,
      baseRef,
      sshConnectionId
    );
    this.entries.set(key, { store, refCount: 1, activated: false });
    return store;
  }

  get(projectId: string, workspaceId: string): WorkspaceStore | undefined {
    return this.entries.get(makeKey(projectId, workspaceId))?.store;
  }

  activate(projectId: string, workspaceId: string): void {
    const entry = this.entries.get(makeKey(projectId, workspaceId));
    if (!entry || entry.activated) {
      return;
    }
    entry.activated = true;
    entry.store.activate();
  }

  release(projectId: string, workspaceId: string): void {
    const key = makeKey(projectId, workspaceId);
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }

    entry.refCount -= 1;

    if (entry.refCount <= 0) {
      entry.store.dispose();
      this.entries.delete(key);
      this.bootstrapStates.delete(key);
    }
  }

  // -------------------------------------------------------------------------
  // Bootstrap state
  // -------------------------------------------------------------------------

  setBootstrapState(projectId: string, workspaceId: string, state: WorkspaceBootstrapState): void {
    this.bootstrapStates.set(makeKey(projectId, workspaceId), state);
  }

  bootstrapStateFor(projectId: string, workspaceId: string): WorkspaceBootstrapState | undefined {
    return this.bootstrapStates.get(makeKey(projectId, workspaceId));
  }
}

export const workspaceRegistry = new WorkspaceRegistryStore();
