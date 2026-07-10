import type { PendingLease, Result, Unsubscribe } from '@emdash/shared';
import { produce } from 'immer';
import { computed, makeObservable, observable, runInAction } from 'mobx';
import type { MutationCallOptions } from '../../api/client';
import type {
  LiveStateData,
  LiveModelKey,
  LiveModelStates,
  LiveModelMutationCtx,
  LiveModelMutations,
  LiveModelDef,
  MutationData,
  MutationError,
  MutationInput,
} from '../../api/define';
import { createMutationId } from '../../live/mutations';
import type {
  ContractMutationInvocation,
  LiveModelReplica,
  ReplicaInstance,
} from '../../live/replica';
import type { LiveChangeMeta, Mutator } from '../../live/state';

export type OptimisticLiveModelValues<Group extends LiveModelDef> = {
  readonly [Name in keyof LiveModelStates<Group>]:
    | LiveStateData<LiveModelStates<Group>[Name]>
    | undefined;
};

export type OptimisticLiveModelMutations<Group extends LiveModelDef> = {
  [Name in keyof LiveModelMutations<Group>]: (
    input: MutationInput<LiveModelMutations<Group>[Name]>,
    options?: Omit<MutationCallOptions, 'mutationId'>
  ) => Promise<
    ContractMutationInvocation<
      MutationData<LiveModelMutations<Group>[Name]>,
      MutationError<LiveModelMutations<Group>[Name]>
    >
  >;
};

type MemberCells<Group extends LiveModelDef> = {
  [Name in keyof LiveModelStates<Group>]: OptimisticMemberCell<
    LiveStateData<LiveModelStates<Group>[Name]>
  >;
};

export class OptimisticLiveModel<Group extends LiveModelDef> {
  readonly values: OptimisticLiveModelValues<Group>;
  readonly mutations: OptimisticLiveModelMutations<Group>;
  readonly ready: Promise<void>;

  private readonly lease: PendingLease<ReplicaInstance<Group>>;
  private readonly binding: Promise<ReplicaInstance<Group>>;
  private readonly cells: MemberCells<Group>;
  private readonly unsubscribes: Unsubscribe[] = [];

  constructor(
    private readonly group: Group,
    key: LiveModelKey<Group>,
    replica: LiveModelReplica<Group>
  ) {
    makeObservable(this, { isPending: computed });

    this.cells = createCells(group);
    this.values = createValues(this.cells);
    this.lease = replica.acquire(key);
    this.binding = this.lease.ready();
    this.ready = this.binding.then((binding) => this.bindAuthoritativeState(binding));
    this.mutations = createMutations(group, this.binding, this.cells, key);
  }

  get isPending(): boolean {
    return Object.values(this.cells).some((cell) => cell.isPending);
  }

  async dispose(): Promise<void> {
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    await this.lease.release();
  }

  private async bindAuthoritativeState(binding: ReplicaInstance<Group>): Promise<void> {
    await binding.ready;
    for (const [name, state] of Object.entries(binding.states)) {
      const cell = this.cells[name as keyof LiveModelStates<Group>];
      if (!cell) continue;
      cell.onAuthoritative(state.current(), { kind: 'seed' });
      this.unsubscribes.push(
        state.onChange((value: unknown, meta: LiveChangeMeta) => {
          cell.onAuthoritative(value as never, meta);
        })
      );
    }
  }
}

class OptimisticMemberCell<T> {
  private base: T | undefined;
  private readonly pending = observable.map<string, Mutator<T>[]>();

  constructor() {
    makeObservable<this, 'base'>(this, {
      base: observable.ref,
      value: computed,
      isPending: computed,
    });
  }

  get value(): T | undefined {
    if (this.base === undefined) return undefined;
    let next = this.base;
    for (const recipes of this.pending.values()) {
      for (const recipe of recipes) next = produce(next, recipe);
    }
    return next;
  }

  get isPending(): boolean {
    return this.pending.size > 0;
  }

  onAuthoritative(value: T, meta: LiveChangeMeta): void {
    runInAction(() => {
      this.base = value;
      if (meta.kind === 'seed') {
        this.pending.clear();
        return;
      }
      for (const mutationId of meta.mutationIds) this.pending.delete(mutationId);
    });
  }

  addRecipes(mutationId: string, recipes: Mutator<T>[]): void {
    if (recipes.length === 0) return;
    runInAction(() => {
      const existing = this.pending.get(mutationId) ?? [];
      this.pending.set(mutationId, [...existing, ...recipes]);
    });
  }

  rollback(mutationId: string): void {
    runInAction(() => {
      this.pending.delete(mutationId);
    });
  }
}

class OverlayLiveModelMutationContext<
  Group extends LiveModelDef,
> implements LiveModelMutationCtx<Group> {
  private readonly recipes = new Map<keyof LiveModelStates<Group>, Mutator<unknown>[]>();

  constructor(
    readonly mutationId: string,
    readonly key: LiveModelKey<Group>
  ) {}

  produce<Name extends keyof LiveModelStates<Group>>(
    name: Name,
    mutator: Mutator<LiveStateData<LiveModelStates<Group>[Name]>>
  ): void {
    const recipes = this.recipes.get(name) ?? [];
    recipes.push(mutator as Mutator<unknown>);
    this.recipes.set(name, recipes);
  }

  commit(cells: MemberCells<Group>): void {
    for (const [name, recipes] of this.recipes) {
      const cell = cells[name];
      cell?.addRecipes(this.mutationId, recipes as never);
    }
  }
}

function createCells<Group extends LiveModelDef>(group: Group): MemberCells<Group> {
  const cells: Record<string, OptimisticMemberCell<unknown>> = {};
  for (const name of Object.keys(group.states)) cells[name] = new OptimisticMemberCell();
  return cells as MemberCells<Group>;
}

function createValues<Group extends LiveModelDef>(
  cells: MemberCells<Group>
): OptimisticLiveModelValues<Group> {
  const values: Record<string, unknown> = {};
  for (const [name, cell] of Object.entries(cells)) {
    Object.defineProperty(values, name, {
      enumerable: true,
      get: () => cell.value,
    });
  }
  return values as OptimisticLiveModelValues<Group>;
}

function createMutations<Group extends LiveModelDef>(
  group: Group,
  binding: Promise<ReplicaInstance<Group>>,
  cells: MemberCells<Group>,
  key: LiveModelKey<Group>
): OptimisticLiveModelMutations<Group> {
  const mutations: Record<string, unknown> = {};
  for (const [name, mutation] of Object.entries(group.mutations)) {
    mutations[name] = async (
      input: unknown,
      options: Omit<MutationCallOptions, 'mutationId'> = {}
    ) => {
      const mutationId = createMutationId();
      const overlay = new OverlayLiveModelMutationContext<Group>(mutationId, key);
      const localResult = runLocalGroupHandler(mutation.handler, overlay, input, mutationId);
      const resolvedLocalResult = isPromiseLike(localResult)
        ? await localResult.catch(() => undefined)
        : localResult;
      if (resolvedLocalResult?.success) overlay.commit(cells);

      try {
        const instance = await binding;
        const invocation = await (
          instance.mutations as Record<
            string,
            (
              input: unknown,
              options?: MutationCallOptions
            ) => Promise<ContractMutationInvocation<unknown, unknown>>
          >
        )[name](input, { ...options, mutationId });

        if (!invocation.result.success) rollback(cells, mutationId);
        else void invocation.settled.finally(() => rollback(cells, mutationId));
        return invocation;
      } catch (error) {
        rollback(cells, mutationId);
        throw error;
      }
    };
  }
  return mutations as OptimisticLiveModelMutations<Group>;
}

function runLocalGroupHandler(
  handler: LiveModelDef['mutations'][string]['handler'],
  overlay: OverlayLiveModelMutationContext<LiveModelDef>,
  input: unknown,
  mutationId: string
): Result<unknown, unknown> | Promise<Result<unknown, unknown>> | undefined {
  if (!handler) return undefined;
  try {
    return handler(overlay, addMutationId(input, mutationId) as never);
  } catch {
    return undefined;
  }
}

function isPromiseLike<T>(value: T | Promise<T> | undefined): value is Promise<T> {
  return typeof (value as Promise<T> | undefined)?.then === 'function';
}

function addMutationId(input: unknown, mutationId: string): Record<string, unknown> {
  if (typeof input === 'object' && input !== null) return { ...input, mutationId };
  if (input === undefined) return { mutationId };
  return { value: input, mutationId };
}

function rollback<Group extends LiveModelDef>(cells: MemberCells<Group>, mutationId: string): void {
  for (const cell of Object.values(cells)) cell.rollback(mutationId);
}
