import { createLiveModelReplica } from '@emdash/wire';
import { OptimisticLiveModel } from '@emdash/wire/util/mobx';
import { makeAutoObservable, observable, reaction, runInAction } from 'mobx';
import { useEffect, useMemo } from 'react';
import { getWorkspacesWireClient } from '@core/features/workspaces/api/browser/client';
import {
  workspacesWireContract,
  type WorkspaceRuntimeState,
} from '@core/features/workspaces/api/wire-contract';

export type WorkspaceRuntimeStatus = 'idle' | 'setting-up' | 'active' | 'tearing-down';

export type WorkspaceRuntimeStatusInput = {
  workspaceId: string | null;
  hasActiveSessions: boolean;
};

type RuntimeReplica = ReturnType<
  typeof createLiveModelReplica<typeof workspacesWireContract.runtime>
>;
type RuntimeModel = OptimisticLiveModel<typeof workspacesWireContract.runtime>;

class WorkspaceRuntimeStatusesStore {
  readonly statuses = observable.map<string, WorkspaceRuntimeStatus>();
  private readonly models = new Map<string, RuntimeModel>();
  private readonly reactions = new Map<string, () => void>();
  private readonly fallbacks = new Map<string, WorkspaceRuntimeStatus>();
  private replica: RuntimeReplica | null = null;
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
        this.statuses.set(input.workspaceId, fallback);
      }
    }

    for (const workspaceId of [...this.models.keys()]) {
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
    const models = [...this.models.values()];
    const reactions = [...this.reactions.values()];
    this.models.clear();
    this.reactions.clear();
    this.statuses.clear();
    this.fallbacks.clear();
    for (const disposeReaction of reactions) disposeReaction();
    await Promise.all(models.map(async (model) => await model.dispose()));
    await this.replica?.dispose();
    this.replica = null;
  }

  private async ensure(workspaceId: string): Promise<void> {
    if (this.models.has(workspaceId) || this.disposed) return;
    const replica = await this.ensureReplica();
    if (this.disposed || this.models.has(workspaceId)) return;

    const model = new OptimisticLiveModel(workspacesWireContract.runtime, { workspaceId }, replica);
    this.models.set(workspaceId, model);
    this.reactions.set(
      workspaceId,
      reaction(
        () => model.values.state,
        (state) => {
          runInAction(() => {
            this.statuses.set(
              workspaceId,
              deriveWorkspaceRuntimeStatus(state, this.fallbacks.get(workspaceId) === 'active')
            );
          });
        },
        { fireImmediately: true }
      )
    );

    try {
      await model.ready;
      if (this.disposed || this.models.get(workspaceId) !== model) {
        await model.dispose();
        return;
      }
      runInAction(() => {
        const state = model.values.state;
        this.statuses.set(
          workspaceId,
          deriveWorkspaceRuntimeStatus(state, this.fallbacks.get(workspaceId) === 'active')
        );
      });
    } catch {
      if (this.models.get(workspaceId) === model) {
        this.statuses.set(workspaceId, this.fallbacks.get(workspaceId) ?? 'idle');
      }
    }
  }

  private async ensureReplica(): Promise<RuntimeReplica> {
    if (this.replica) return this.replica;
    const client = await getWorkspacesWireClient();
    if (this.replica) return this.replica;
    this.replica = createLiveModelReplica(workspacesWireContract.runtime, client.runtime);
    return this.replica;
  }

  private async remove(workspaceId: string): Promise<void> {
    const model = this.models.get(workspaceId);
    if (!model) return;
    this.reactions.get(workspaceId)?.();
    this.reactions.delete(workspaceId);
    this.models.delete(workspaceId);
    this.statuses.delete(workspaceId);
    this.fallbacks.delete(workspaceId);
    await model.dispose();
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
): WorkspaceRuntimeStatus {
  const operationKind = state?.operation.kind;
  if (
    operationKind === 'teardown' ||
    operationKind === 'deactivate' ||
    operationKind === 'clean-artifacts'
  ) {
    return 'tearing-down';
  }
  if (
    operationKind === 'provision' ||
    operationKind === 'convert' ||
    operationKind === 'activate' ||
    operationKind === 'reconcile'
  ) {
    return 'setting-up';
  }
  if ((state?.consumers.length ?? 0) > 0 || hasActiveSessions) return 'active';
  return 'idle';
}
