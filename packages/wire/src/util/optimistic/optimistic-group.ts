import type { Result } from '@emdash/shared';
import { produce } from 'immer';
import { computed, makeObservable, observable, runInAction } from 'mobx';
import type {
  ContractMutationInvocation,
  GroupBinding,
  MutationCallOptions,
} from '../../api/client';
import type {
  EndpointLiveModelData,
  GroupKey,
  GroupModels,
  GroupMutationCtx,
  GroupMutations,
  LiveModelGroupDef,
  MutationData,
  MutationError,
  MutationInput,
} from '../../api/define';
import type { LiveChangeMeta, Mutator } from '../../live/model';
import { createMutationId } from '../../live/mutations';

export type OptimisticLiveModelGroupValues<Group extends LiveModelGroupDef> = {
  readonly [Name in keyof GroupModels<Group>]:
    | EndpointLiveModelData<GroupModels<Group>[Name]>
    | undefined;
};

export type OptimisticLiveModelGroupMutations<Group extends LiveModelGroupDef> = {
  [Name in keyof GroupMutations<Group>]: (
    input: MutationInput<GroupMutations<Group>[Name]>,
    options?: Omit<MutationCallOptions, 'mutationId'>
  ) => Promise<
    ContractMutationInvocation<
      MutationData<GroupMutations<Group>[Name]>,
      MutationError<GroupMutations<Group>[Name]>
    >
  >;
};

export type OptimisticLiveModelGroupBinding<Group extends LiveModelGroupDef> = (
  key: GroupKey<Group>,
  onChange?: OptimisticLiveModelGroupOnChange<Group>
) => GroupBinding<Group>;

type OptimisticLiveModelGroupOnChange<Group extends LiveModelGroupDef> = Partial<{
  [Name in keyof GroupModels<Group>]: (
    value: EndpointLiveModelData<GroupModels<Group>[Name]>,
    meta: LiveChangeMeta
  ) => void;
}>;

type MemberCells<Group extends LiveModelGroupDef> = {
  [Name in keyof GroupModels<Group>]: OptimisticMemberCell<
    EndpointLiveModelData<GroupModels<Group>[Name]>
  >;
};

export class OptimisticLiveModelGroup<Group extends LiveModelGroupDef> {
  readonly values: OptimisticLiveModelGroupValues<Group>;
  readonly mutations: OptimisticLiveModelGroupMutations<Group>;
  readonly ready: Promise<void>;

  private readonly binding: GroupBinding<Group>;
  private readonly cells: MemberCells<Group>;

  constructor(
    private readonly group: Group,
    key: GroupKey<Group>,
    bind: OptimisticLiveModelGroupBinding<Group>
  ) {
    makeObservable(this, { isPending: computed });

    this.cells = createCells(group);
    this.values = createValues(this.cells);
    this.binding = bind(key, createOnChange(this.cells));
    this.ready = this.binding.ready;
    this.mutations = createMutations(group, this.binding, this.cells, key);
  }

  get isPending(): boolean {
    return Object.values(this.cells).some((cell) => cell.isPending);
  }

  async dispose(): Promise<void> {
    await this.binding.dispose();
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

class OverlayGroupMutationContext<
  Group extends LiveModelGroupDef,
> implements GroupMutationCtx<Group> {
  private readonly recipes = new Map<keyof GroupModels<Group>, Mutator<unknown>[]>();

  constructor(
    readonly mutationId: string,
    readonly key: GroupKey<Group>
  ) {}

  produce<Name extends keyof GroupModels<Group>>(
    name: Name,
    mutator: Mutator<EndpointLiveModelData<GroupModels<Group>[Name]>>
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

function createCells<Group extends LiveModelGroupDef>(group: Group): MemberCells<Group> {
  const cells: Record<string, OptimisticMemberCell<unknown>> = {};
  for (const name of Object.keys(group.models)) cells[name] = new OptimisticMemberCell();
  return cells as MemberCells<Group>;
}

function createValues<Group extends LiveModelGroupDef>(
  cells: MemberCells<Group>
): OptimisticLiveModelGroupValues<Group> {
  const values: Record<string, unknown> = {};
  for (const [name, cell] of Object.entries(cells)) {
    Object.defineProperty(values, name, {
      enumerable: true,
      get: () => cell.value,
    });
  }
  return values as OptimisticLiveModelGroupValues<Group>;
}

function createOnChange<Group extends LiveModelGroupDef>(
  cells: MemberCells<Group>
): OptimisticLiveModelGroupOnChange<Group> {
  const onChange: Record<string, (value: unknown, meta: LiveChangeMeta) => void> = {};
  for (const [name, cell] of Object.entries(cells)) {
    onChange[name] = (value, meta) => cell.onAuthoritative(value, meta);
  }
  return onChange as OptimisticLiveModelGroupOnChange<Group>;
}

function createMutations<Group extends LiveModelGroupDef>(
  group: Group,
  binding: GroupBinding<Group>,
  cells: MemberCells<Group>,
  key: GroupKey<Group>
): OptimisticLiveModelGroupMutations<Group> {
  const mutations: Record<string, unknown> = {};
  for (const [name, mutation] of Object.entries(group.mutations)) {
    mutations[name] = async (
      input: unknown,
      options: Omit<MutationCallOptions, 'mutationId'> = {}
    ) => {
      const mutationId = createMutationId();
      const overlay = new OverlayGroupMutationContext<Group>(mutationId, key);
      const localResult = runLocalGroupHandler(mutation.handler, overlay, input, mutationId);
      const resolvedLocalResult = isPromiseLike(localResult)
        ? await localResult.catch(() => undefined)
        : localResult;
      if (resolvedLocalResult?.success) overlay.commit(cells);

      try {
        const invocation = await (
          binding as Record<
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
  return mutations as OptimisticLiveModelGroupMutations<Group>;
}

function runLocalGroupHandler(
  handler: LiveModelGroupDef['mutations'][string]['handler'],
  overlay: OverlayGroupMutationContext<LiveModelGroupDef>,
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

function rollback<Group extends LiveModelGroupDef>(
  cells: MemberCells<Group>,
  mutationId: string
): void {
  for (const cell of Object.values(cells)) cell.rollback(mutationId);
}
