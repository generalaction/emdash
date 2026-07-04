import type { Result } from '@emdash/shared';
import { makeAutoObservable, observable, runInAction } from 'mobx';
import { toast } from '@renderer/lib/hooks/use-toast';
import { events, rpc } from '@renderer/lib/ipc';
import { loopPhaseUpdatedChannel, loopUpdatedChannel } from '@shared/core/loops/loopEvents';
import type {
  CreateLoopParams,
  Loop,
  LoopPhase,
  LoopVerifierAvailability,
  LoopWithPhases,
} from '@shared/core/loops/loops';

type EventDefinition<TData> = {
  name: string;
  _data?: TData;
};

type LoopRpcResult<T> = Result<T, unknown>;

export type LoopsRpcClient = {
  createLoop(params: CreateLoopParams): Promise<LoopRpcResult<LoopWithPhases>>;
  getLoopsForProject(projectId: string): Promise<LoopRpcResult<LoopWithPhases[]>>;
  getLoop(loopId: string): Promise<LoopRpcResult<LoopWithPhases>>;
  getVerifierAvailability(taskId: string): Promise<LoopRpcResult<LoopVerifierAvailability[]>>;
  startLoop(loopId: string): Promise<LoopRpcResult<LoopWithPhases>>;
  pauseLoop(loopId: string): Promise<LoopRpcResult<LoopWithPhases>>;
  resumeLoop(loopId: string): Promise<LoopRpcResult<LoopWithPhases>>;
  cancelLoop(loopId: string): Promise<LoopRpcResult<LoopWithPhases>>;
  retryPhase(loopId: string, phaseId: string): Promise<LoopRpcResult<LoopWithPhases>>;
  deleteLoop(loopId: string): Promise<LoopRpcResult<void>>;
};

export type LoopsEventClient = {
  on<TData>(event: EventDefinition<TData>, cb: (data: TData) => void): () => void;
};

type LoadState = {
  kind: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
};

const idleLoadState: LoadState = { kind: 'idle' };

function messageFromUnknown(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  if (typeof error === 'string' && error.trim()) return error;
  return 'Loop request failed';
}

function sortedPhases(phases: LoopPhase[]): LoopPhase[] {
  return [...phases].sort((a, b) => a.idx - b.idx);
}

function mergeLoop(existing: LoopWithPhases | undefined, loop: Loop): LoopWithPhases {
  return {
    ...(existing ?? { phases: [] }),
    ...loop,
    phases: existing?.phases ?? [],
  };
}

export class LoopsStore {
  readonly loopsById = observable.map<string, LoopWithPhases>();
  readonly projectLoopIds = observable.map<string, string[]>();
  readonly projectLoadStates = observable.map<string, LoadState>();
  readonly loopLoadStates = observable.map<string, LoadState>();
  readonly actionPending = observable.map<string, boolean>();
  readonly actionErrors = observable.map<string, string>();

  private readonly rpcClient: LoopsRpcClient;
  private readonly eventClient: LoopsEventClient;
  private readonly disposers: (() => void)[] = [];

  constructor(deps: { rpcClient?: LoopsRpcClient; eventClient?: LoopsEventClient } = {}) {
    this.rpcClient = deps.rpcClient ?? rpc.loops;
    this.eventClient = deps.eventClient ?? events;

    makeAutoObservable<this, 'rpcClient' | 'eventClient' | 'disposers'>(
      this,
      {
        loopsById: observable.shallow,
        projectLoopIds: observable.shallow,
        projectLoadStates: observable.shallow,
        loopLoadStates: observable.shallow,
        actionPending: observable.shallow,
        actionErrors: observable.shallow,
        rpcClient: false,
        eventClient: false,
        disposers: false,
      },
      { autoBind: true }
    );

    this.subscribe();
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0)) {
      dispose();
    }
  }

  getLoopsForProject(projectId: string): LoopWithPhases[] {
    return (this.projectLoopIds.get(projectId) ?? [])
      .map((loopId) => this.loopsById.get(loopId))
      .filter((loop): loop is LoopWithPhases => loop !== undefined);
  }

  getLoop(loopId: string): LoopWithPhases | undefined {
    return this.loopsById.get(loopId);
  }

  getProjectLoadState(projectId: string): LoadState {
    return this.projectLoadStates.get(projectId) ?? idleLoadState;
  }

  getLoopLoadState(loopId: string): LoadState {
    return this.loopLoadStates.get(loopId) ?? idleLoadState;
  }

  isActionPending(loopId: string): boolean {
    return this.actionPending.get(loopId) ?? false;
  }

  getActionError(loopId: string): string | undefined {
    return this.actionErrors.get(loopId);
  }

  ensureProjectLoaded(projectId: string): void {
    const state = this.getProjectLoadState(projectId).kind;
    if (state === 'loading' || state === 'ready') return;
    void this.loadProject(projectId);
  }

  ensureLoopLoaded(loopId: string): void {
    const state = this.getLoopLoadState(loopId).kind;
    if (state === 'loading' || state === 'ready') return;
    void this.loadLoop(loopId);
  }

  async loadProject(projectId: string): Promise<void> {
    runInAction(() => {
      this.projectLoadStates.set(projectId, { kind: 'loading' });
    });

    const result = await this.rpcClient.getLoopsForProject(projectId);
    runInAction(() => {
      if (!result.success) {
        this.projectLoadStates.set(projectId, {
          kind: 'error',
          error: messageFromUnknown(result.error),
        });
        return;
      }

      this.replaceProjectLoops(projectId, result.data);
      this.projectLoadStates.set(projectId, { kind: 'ready' });
    });
  }

  async loadLoop(loopId: string): Promise<void> {
    runInAction(() => {
      this.loopLoadStates.set(loopId, { kind: 'loading' });
    });

    const result = await this.rpcClient.getLoop(loopId);
    runInAction(() => {
      if (!result.success) {
        this.loopLoadStates.set(loopId, {
          kind: 'error',
          error: messageFromUnknown(result.error),
        });
        return;
      }

      this.applyLoopWithPhases(result.data);
      this.loopLoadStates.set(loopId, { kind: 'ready' });
    });
  }

  async createLoop(params: CreateLoopParams): Promise<LoopRpcResult<LoopWithPhases>> {
    const result = await this.rpcClient.createLoop(params);
    runInAction(() => {
      if (result.success) this.applyLoopWithPhases(result.data);
    });
    return result;
  }

  startLoop(loopId: string): Promise<LoopRpcResult<LoopWithPhases>> {
    return this.runLoopAction(loopId, 'Start loop failed', () => this.rpcClient.startLoop(loopId));
  }

  pauseLoop(loopId: string): Promise<LoopRpcResult<LoopWithPhases>> {
    return this.runLoopAction(loopId, 'Pause loop failed', () => this.rpcClient.pauseLoop(loopId));
  }

  resumeLoop(loopId: string): Promise<LoopRpcResult<LoopWithPhases>> {
    return this.runLoopAction(loopId, 'Resume loop failed', () =>
      this.rpcClient.resumeLoop(loopId)
    );
  }

  cancelLoop(loopId: string): Promise<LoopRpcResult<LoopWithPhases>> {
    return this.runLoopAction(loopId, 'Cancel loop failed', () =>
      this.rpcClient.cancelLoop(loopId)
    );
  }

  retryPhase(loopId: string, phaseId: string): Promise<LoopRpcResult<LoopWithPhases>> {
    return this.runLoopAction(loopId, 'Retry phase failed', () =>
      this.rpcClient.retryPhase(loopId, phaseId)
    );
  }

  async deleteLoop(loopId: string): Promise<LoopRpcResult<void>> {
    this.actionPending.set(loopId, true);
    this.actionErrors.delete(loopId);
    const result = await this.rpcClient.deleteLoop(loopId);
    runInAction(() => {
      this.actionPending.delete(loopId);
      if (result.success) {
        this.removeLoop(loopId);
      } else {
        this.actionErrors.set(loopId, messageFromUnknown(result.error));
      }
    });
    return result;
  }

  async getVerifierAvailability(
    taskId: string
  ): Promise<LoopRpcResult<LoopVerifierAvailability[]>> {
    return this.rpcClient.getVerifierAvailability(taskId);
  }

  private subscribe(): void {
    this.disposers.push(
      this.eventClient.on(loopUpdatedChannel, ({ loop }) => {
        runInAction(() => {
          this.applyLoopUpdated(loop);
        });
      }),
      this.eventClient.on(loopPhaseUpdatedChannel, ({ loopId, phase }) => {
        runInAction(() => {
          this.applyPhaseUpdated(loopId, phase);
        });
      })
    );
  }

  private async runLoopAction(
    loopId: string,
    errorTitle: string,
    action: () => Promise<LoopRpcResult<LoopWithPhases>>
  ): Promise<LoopRpcResult<LoopWithPhases>> {
    runInAction(() => {
      this.actionPending.set(loopId, true);
      this.actionErrors.delete(loopId);
    });

    const result = await action();
    runInAction(() => {
      this.actionPending.delete(loopId);
      if (result.success) {
        this.applyLoopWithPhases(result.data);
      } else {
        const message = messageFromUnknown(result.error);
        this.actionErrors.set(loopId, message);
        toast({ title: errorTitle, description: message, variant: 'destructive' });
      }
    });
    return result;
  }

  private replaceProjectLoops(projectId: string, loops: LoopWithPhases[]): void {
    const nextIds = loops.map((loop) => loop.id);
    const previousIds = this.projectLoopIds.get(projectId) ?? [];
    for (const loopId of previousIds) {
      if (!nextIds.includes(loopId)) this.loopsById.delete(loopId);
    }
    for (const loop of loops) {
      this.loopsById.set(loop.id, { ...loop, phases: sortedPhases(loop.phases) });
    }
    this.projectLoopIds.set(projectId, nextIds);
  }

  private applyLoopWithPhases(loop: LoopWithPhases): void {
    this.loopsById.set(loop.id, { ...loop, phases: sortedPhases(loop.phases) });
    this.addLoopIdToProject(loop.projectId, loop.id);
  }

  private applyLoopUpdated(loop: Loop): void {
    this.loopsById.set(loop.id, mergeLoop(this.loopsById.get(loop.id), loop));
    this.addLoopIdToProject(loop.projectId, loop.id);
  }

  private applyPhaseUpdated(loopId: string, phase: LoopPhase): void {
    const loop = this.loopsById.get(loopId);
    if (!loop) {
      void this.loadLoop(loopId);
      return;
    }

    const phases = loop.phases.filter((candidate) => candidate.id !== phase.id);
    phases.push(phase);
    this.loopsById.set(loopId, { ...loop, phases: sortedPhases(phases) });
  }

  private addLoopIdToProject(projectId: string, loopId: string): void {
    const current = this.projectLoopIds.get(projectId);
    if (!current) return;
    if (current.includes(loopId)) return;
    this.projectLoopIds.set(projectId, [loopId, ...current]);
  }

  private removeLoop(loopId: string): void {
    this.loopsById.delete(loopId);
    this.loopLoadStates.delete(loopId);
    this.actionErrors.delete(loopId);
    for (const [projectId, loopIds] of this.projectLoopIds) {
      if (loopIds.includes(loopId)) {
        this.projectLoopIds.set(
          projectId,
          loopIds.filter((id) => id !== loopId)
        );
      }
    }
  }
}

let defaultLoopsStore: LoopsStore | undefined;

export function getLoopsStore(): LoopsStore {
  defaultLoopsStore ??= new LoopsStore();
  return defaultLoopsStore;
}

export const loopsStore = new Proxy({} as LoopsStore, {
  get(_target, prop, receiver) {
    return Reflect.get(getLoopsStore(), prop, receiver);
  },
});
