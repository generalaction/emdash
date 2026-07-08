import type {
  GroupKey,
  GroupMutationHandler,
  GroupMutations,
  LiveModelGroupDef,
  MutationDef,
} from '../../api/define';
import { WireError } from '../../api/protocol';
import { createGroupInstance, type GroupInitialState, type LiveModelGroupInstance } from './group';
import { stableStringify } from './registry';

export type LiveModelHostMutationHandlers<Group extends LiveModelGroupDef> = Partial<{
  [Name in keyof GroupMutations<Group>]: GroupMutations<Group>[Name] extends MutationDef<
    infer Input,
    infer Data,
    infer Error
  >
    ? GroupMutationHandler<Input, Data, Error>
    : never;
}>;

export type LiveModelHostOptions<Group extends LiveModelGroupDef> = {
  mutations?: LiveModelHostMutationHandlers<Group>;
  generation?: number;
};

export type LiveInstance<Group extends LiveModelGroupDef = LiveModelGroupDef> =
  LiveModelGroupInstance<Group> & {
    dispose(): void;
  };

export type LiveModelHost<Group extends LiveModelGroupDef = LiveModelGroupDef> = {
  readonly kind: 'liveModelHost';
  readonly contract: Group;
  create(key: GroupKey<Group>, initialState: GroupInitialState<Group>): LiveInstance<Group>;
  get(key: GroupKey<Group>): LiveInstance<Group> | undefined;
  instances(partialKey?: Partial<GroupKey<Group>>): Array<[GroupKey<Group>, LiveInstance<Group>]>;
  mutationHandler<Name extends keyof GroupMutations<Group>>(
    name: Name
  ): LiveModelHostMutationHandlers<Group>[Name] | undefined;
  dispose(): void;
};

export function createLiveModelHost<Group extends LiveModelGroupDef>(
  contract: Group,
  options: LiveModelHostOptions<Group> = {}
): LiveModelHost<Group> {
  const entries = new Map<string, LiveInstance<Group>>();

  function remove(key: GroupKey<Group>, instance: LiveInstance<Group>): void {
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
      const matches: Array<[GroupKey<Group>, LiveInstance<Group>]> = [];
      for (const instance of entries.values()) {
        if (!matchesPartial(instance.key, partialKey)) continue;
        matches.push([instance.key, instance]);
      }
      return matches;
    },
    mutationHandler(name) {
      return options.mutations?.[name];
    },
    dispose() {
      for (const instance of [...entries.values()]) instance.dispose();
      entries.clear();
    },
  };
}

export function isLiveModelHost(value: unknown): value is LiveModelHost {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'liveModelHost'
  );
}

function createLiveInstance<Group extends LiveModelGroupDef>(
  contract: Group,
  key: GroupKey<Group>,
  initialState: GroupInitialState<Group>,
  options: {
    generation: number | undefined;
    onDispose: (key: GroupKey<Group>, instance: LiveInstance<Group>) => void;
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
