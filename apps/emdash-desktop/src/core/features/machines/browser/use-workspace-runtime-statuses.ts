import { createScope, type Scope } from '@emdash/shared/concurrency';
import { observe, remote, type RemoteModel } from '@emdash/wire';
import { makeAutoObservable, observable, runInAction } from 'mobx';
import { useEffect, useMemo } from 'react';
import { getWorkspacesWireClient } from '@core/features/workspaces/api/browser/client';
import {
  workspacesWireContract,
  type WorkspaceRuntimeState,
} from '@core/features/workspaces/api/wire-contract';

export type WorkspaceRuntimeStatus = 'idle' | 'setting-up' | 'active' | 'tearing-down' | 'error';
export type WorkspacePhaseKind = WorkspaceRuntimeState['phase']['kind'];
export type WorkspaceRuntimeStatusDetails = {
  status: WorkspaceRuntimeStatus;
  phase?: WorkspacePhaseKind;
  errorMessage?: string;
};

export type WorkspaceRuntimeStatusInput = {
  workspaceId: string | null;
  hasActiveSessions: boolean;
};

type RuntimeRemote = RemoteModel<typeof workspacesWireContract.runtime>;

class WorkspaceRuntimeStatusesStore {
  readonly statuses = observable.map<string, WorkspaceRuntimeStatusDetails>();
  private readonly scope = createScope({ label: 'workspace-runtime-statuses' });
  private readonly scopes = new Map<string, Scope>();
  private readonly fallbacks = new Map<string, WorkspaceRuntimeStatus>();
  private remotePromise: Promise<RuntimeRemote> | null = null;
  private disposed = false;

  constructor() {
    makeAutoObservable(this, { statuses: false }, { autoBind: true });
  }

  update(inputs: WorkspaceRuntimeStatusInput[]): void {
    const nextIds = new Set<string>();
    for (const input of inputs) {
      if (!input.workspaceId) continue;
      nextIds.add(input.workspaceId);
      const fallback = input.hasActiveSessions ? 'active' : 'idle';
      this.fallbacks.set(input.workspaceId, fallback);
      if (!this.statuses.has(input.workspaceId)) {
        this.statuses.set(
          input.workspaceId,
          deriveWorkspaceRuntimeStatus(undefined, fallback === 'active')
        );
      }
    }

    for (const workspaceId of [...this.scopes.keys()]) {
      if (nextIds.has(workspaceId)) continue;
      void this.remove(workspaceId);
    }
    for (const workspaceId of [...this.statuses.keys()]) {
      if (nextIds.has(workspaceId)) continue;
      this.statuses.delete(workspaceId);
      this.fallbacks.delete(workspaceId);
    }
    for (const workspaceId of nextIds) {
      void this.ensure(workspaceId);
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const scopes = [...this.scopes.values()];
    this.scopes.clear();
    this.statuses.clear();
    this.fallbacks.clear();
    await Promise.all(scopes.map(async (scope) => await scope.dispose()));
    await this.scope.dispose();
  }

  private async ensure(workspaceId: string): Promise<void> {
    if (this.scopes.has(workspaceId) || this.disposed) return;
    const runtimeRemote = await this.ensureRemote();
    if (this.disposed || this.scopes.has(workspaceId)) return;

    const scope = this.scope.child(`runtime:${workspaceId}`);
    this.scopes.set(workspaceId, scope);
    const member = runtimeRemote({ workspaceId });
    observe(
      member.states.state,
      (snapshot) => {
        runInAction(() => {
          this.statuses.set(
            workspaceId,
            deriveWorkspaceRuntimeStatus(
              snapshot.value,
              this.fallbacks.get(workspaceId) === 'active'
            )
          );
        });
      },
      { scope }
    );

    try {
      await member.states.state.refresh();
      if (this.disposed || this.scopes.get(workspaceId) !== scope) {
        await scope.dispose();
        return;
      }
    } catch {
      if (this.scopes.get(workspaceId) === scope) {
        runInAction(() => {
          this.statuses.set(
            workspaceId,
            deriveWorkspaceRuntimeStatus(undefined, this.fallbacks.get(workspaceId) === 'active')
          );
        });
      }
    }
  }

  private async ensureRemote(): Promise<RuntimeRemote> {
    if (this.remotePromise) return this.remotePromise;
    this.remotePromise = getWorkspacesWireClient().then((client) =>
      remote(workspacesWireContract.runtime, client.runtime, {
        scope: this.scope,
        lingerMs: 15_000,
      })
    );
    return this.remotePromise;
  }

  private async remove(workspaceId: string): Promise<void> {
    const scope = this.scopes.get(workspaceId);
    if (!scope) return;
    this.scopes.delete(workspaceId);
    this.statuses.delete(workspaceId);
    this.fallbacks.delete(workspaceId);
    await scope.dispose();
  }
}

export function useWorkspaceRuntimeStatuses(inputs: WorkspaceRuntimeStatusInput[]) {
  const store = useMemo(() => new WorkspaceRuntimeStatusesStore(), []);

  useEffect(() => {
    store.update(inputs);
  }, [inputs, store]);

  useEffect(() => {
    return () => {
      void store.dispose();
    };
  }, [store]);

  return store.statuses;
}

function deriveWorkspaceRuntimeStatus(
  state: WorkspaceRuntimeState | undefined,
  hasActiveSessions: boolean
): WorkspaceRuntimeStatusDetails {
  if (!state) return { status: hasActiveSessions ? 'active' : 'idle' };
  switch (state.phase.kind) {
    case 'provisioning':
    case 'activating':
      return { status: 'setting-up', phase: state.phase.kind };
    case 'deactivating':
    case 'tearing-down':
    case 'cleaning':
      return { status: 'tearing-down', phase: state.phase.kind };
    case 'active':
      return { status: 'active', phase: state.phase.kind };
    case 'broken':
      return {
        status: 'error',
        phase: state.phase.kind,
        errorMessage: state.lastError?.message ?? state.phase.error.message,
      };
    case 'ready':
    case 'provisioned':
    case 'unprovisioned':
      return { status: 'idle', phase: state.phase.kind };
  }
}
