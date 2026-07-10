import { err, ok } from '@emdash/shared';
import type {
  LiveModelKey,
  LiveModelMutationHandler,
  LiveModelMutations,
  LiveModelDef,
  MutationData,
  MutationDef,
  MutationError,
  MutationInput,
} from '../../api/define';
import { WireError } from '../../api/protocol';
import type { WireInstrumentation } from '../../observability';
import {
  LiveModelMutationContext,
  createGroupInstance,
  type LiveModelInitialState,
  type LiveModelInstance,
} from './group';
import { stableStringify } from './registry';
import { MutationResultCache, type MutationResultCacheOptions } from './result-cache';
import type { LiveMutationResult } from './types';

export type LiveModelHostMutationHandlers<Group extends LiveModelDef> = Partial<{
  [Name in keyof LiveModelMutations<Group>]: LiveModelMutations<Group>[Name] extends MutationDef<
    infer Input,
    infer Data,
    infer Error
  >
    ? LiveModelMutationHandler<Input, Data, Error>
    : never;
}>;

export type LiveModelHostOptions<Group extends LiveModelDef> = {
  mutations?: LiveModelHostMutationHandlers<Group>;
  generation?: number;
  idempotency?: MutationResultCacheOptions | false;
  instrumentation?: WireInstrumentation;
};

export type LiveInstance<Group extends LiveModelDef = LiveModelDef> = LiveModelInstance<Group> & {
  dispose(): void;
};

export type LiveModelHost<Group extends LiveModelDef = LiveModelDef> = {
  readonly kind: 'liveModelHost';
  readonly contract: Group;
  create(key: LiveModelKey<Group>, initialState: LiveModelInitialState<Group>): LiveInstance<Group>;
  get(key: LiveModelKey<Group>): LiveInstance<Group> | undefined;
  instances(
    partialKey?: Partial<LiveModelKey<Group>>
  ): Array<[LiveModelKey<Group>, LiveInstance<Group>]>;
  mutationHandler<Name extends keyof LiveModelMutations<Group>>(
    name: Name
  ): LiveModelHostMutationHandlers<Group>[Name] | undefined;
  runMutation<Name extends Extract<keyof LiveModelMutations<Group>, string>>(
    name: Name,
    envelope: {
      key: LiveModelKey<Group>;
      input: MutationInput<LiveModelMutations<Group>[Name]>;
      mutationId: string;
    }
  ): Promise<
    LiveMutationResult<
      MutationData<LiveModelMutations<Group>[Name]>,
      MutationError<LiveModelMutations<Group>[Name]>
    >
  >;
  dispose(): void;
};

export function createLiveModelHost<Group extends LiveModelDef>(
  contract: Group,
  options: LiveModelHostOptions<Group> = {}
): LiveModelHost<Group> {
  const entries = new Map<string, LiveInstance<Group>>();
  const mutationCache =
    options.idempotency === false ? undefined : new MutationResultCache(options.idempotency);

  function remove(key: LiveModelKey<Group>, instance: LiveInstance<Group>): void {
    const keyId = stableStringify(key);
    if (entries.get(keyId) === instance) entries.delete(keyId);
  }

  return {
    kind: 'liveModelHost',
    contract,
    create(key, initialState) {
      const keyId = stableStringify(key);
      if (entries.has(keyId)) {
        throw new WireError('ALREADY_EXISTS', `Live model instance already exists '${keyId}'`);
      }

      const instance = createLiveInstance(contract, key, initialState, {
        generation: options.generation,
        onDispose: remove,
      });
      entries.set(keyId, instance);
      return instance;
    },
    get(key) {
      return entries.get(stableStringify(key));
    },
    instances(partialKey = {}) {
      const matches: Array<[LiveModelKey<Group>, LiveInstance<Group>]> = [];
      for (const instance of entries.values()) {
        if (!matchesPartial(instance.key, partialKey)) continue;
        matches.push([instance.key, instance]);
      }
      return matches;
    },
    mutationHandler(name) {
      return options.mutations?.[name];
    },
    runMutation(name, envelope) {
      return runHostMutation(name, envelope);
    },
    dispose() {
      mutationCache?.clear();
      for (const instance of [...entries.values()]) instance.dispose();
      entries.clear();
    },
  };

  async function runHostMutation<Name extends Extract<keyof LiveModelMutations<Group>, string>>(
    name: Name,
    envelope: {
      key: LiveModelKey<Group>;
      input: MutationInput<LiveModelMutations<Group>[Name]>;
      mutationId: string;
    }
  ): Promise<
    LiveMutationResult<
      MutationData<LiveModelMutations<Group>[Name]>,
      MutationError<LiveModelMutations<Group>[Name]>
    >
  > {
    const handler = options.mutations?.[name] ?? contract.mutations[name]?.handler;
    if (!handler) {
      throw new WireError(
        'MISSING_HANDLER',
        `Mutation '${contract.id}.${String(name)}' requires a handler`
      );
    }
    const instance = entries.get(stableStringify(envelope.key));
    if (!instance) {
      throw new WireError('NOT_FOUND', `Unknown live model instance '${contract.id}'`);
    }
    const execute = async (): Promise<
      LiveMutationResult<
        MutationData<LiveModelMutations<Group>[Name]>,
        MutationError<LiveModelMutations<Group>[Name]>
      >
    > => {
      const ctx = new LiveModelMutationContext(
        contract,
        envelope.key,
        instance,
        envelope.mutationId
      );
      const result = await handler(ctx, {
        ...objectInput(envelope.input),
        mutationId: envelope.mutationId,
      });
      return result.success
        ? ok({
            data: result.data as MutationData<LiveModelMutations<Group>[Name]>,
            cursors: ctx.cursors(),
          })
        : err(result.error as MutationError<LiveModelMutations<Group>[Name]>);
    };
    if (!mutationCache) return execute();
    return mutationCache.run(envelope.mutationId, execute, {
      onDedupe: () =>
        options.instrumentation?.mutationDeduped?.({
          mutationId: envelope.mutationId,
          path: `${contract.id}.${String(name)}`,
        }),
    });
  }
}

export function isLiveModelHost(value: unknown): value is LiveModelHost {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'liveModelHost'
  );
}

function createLiveInstance<Group extends LiveModelDef>(
  contract: Group,
  key: LiveModelKey<Group>,
  initialState: LiveModelInitialState<Group>,
  options: {
    generation: number | undefined;
    onDispose: (key: LiveModelKey<Group>, instance: LiveInstance<Group>) => void;
  }
): LiveInstance<Group> {
  const instance = createGroupInstance(contract, key, initialState, {
    generation: options.generation,
  }) as LiveInstance<Group>;
  let disposed = false;
  instance.dispose = () => {
    if (disposed) return;
    disposed = true;
    options.onDispose(key, instance);
  };
  return instance;
}

function matchesPartial(candidate: unknown, partial: unknown): boolean {
  if (!isRecord(partial)) return stableStringify(candidate) === stableStringify(partial);
  if (!isRecord(candidate)) return false;
  for (const [key, expected] of Object.entries(partial)) {
    if (isRecord(expected)) {
      if (!matchesPartial(candidate[key], expected)) return false;
      continue;
    }
    if (stableStringify(candidate[key]) !== stableStringify(expected)) return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectInput(input: unknown): Record<string, unknown> {
  if (typeof input === 'object' && input !== null && !Array.isArray(input))
    return input as Record<string, unknown>;
  if (input === undefined) return {};
  return { value: input };
}
