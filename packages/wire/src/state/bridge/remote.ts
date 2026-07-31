import type { Scope } from '@emdash/shared/concurrency';
import type { Clock } from '@emdash/shared/scheduling';
import type { LiveModelClientHandle, MutationCallOptions } from '../../api/client';
import type { LiveModelDef, LiveModelKey, LiveModelStates, LiveStateData } from '../../api/define';
import {
  createLiveModelReplica,
  type LiveModelReplicaOptions,
  type ReplicaInstance,
  type ReplicaMutations,
} from '../../live/replica';
import { cell, family, peek, type Cell, type Family, type Readable } from '../core';

type StateName<Group extends LiveModelDef> = Extract<keyof LiveModelStates<Group>, string>;

type RemoteStates<Group extends LiveModelDef> = {
  [Name in StateName<Group>]: Readable<LiveStateData<LiveModelStates<Group>[Name]> | undefined>;
};

type RemoteMember<Group extends LiveModelDef> = {
  states: RemoteStates<Group>;
  mutations: ReplicaMutations<Group>;
};

export type RemoteModel<Group extends LiveModelDef> = Family<LiveModelKey<Group>, RemoteMember<Group>>;

export type RemoteOptions<Group extends LiveModelDef> = LiveModelReplicaOptions<Group> & {
  scope?: Scope;
  lingerMs?: number;
  clock?: Clock;
};

export function remote<Group extends LiveModelDef>(
  contract: Group,
  client: LiveModelClientHandle<Group>,
  options: RemoteOptions<Group> = {}
): RemoteModel<Group> {
  const replica = createLiveModelReplica(contract, client, {
    ...options,
    retentionMs: options.lingerMs ?? options.retentionMs,
  });

  const members: RemoteModel<Group> = family(
    (key: LiveModelKey<Group>, scope) => {
      const stateCells: Record<string, Cell<unknown>> = {};
      const mutations: Record<string, unknown> = {};
      let observedStates = 0;
      let releaseMember: (() => void) | undefined;
      const handleObservedChange = (observed: boolean): void => {
        observedStates += observed ? 1 : -1;
        if (observedStates === 1 && observed) {
          releaseMember = members.retain(key);
        } else if (observedStates === 0 && !observed) {
          releaseMember?.();
          releaseMember = undefined;
        }
      };
      for (const name of Object.keys(contract.states)) {
        stateCells[name] = cell<unknown>(undefined, {
          name: `${contract.id}.${name}`,
          onObservedChange: handleObservedChange,
        });
        stateCells[name].set(undefined, { status: 'loading', notify: false });
      }
      const lease = replica.acquire(key);
      const readyInstance = lease.ready();
      scope.add(() => lease.release());
      for (const name of Object.keys(contract.mutations)) {
        mutations[name] = async (input: unknown, options: MutationCallOptions = {}) => {
          const instance = (await readyInstance) as ReplicaInstance<Group>;
          return await instance.mutations[name as keyof ReplicaMutations<Group>](
            input as never,
            options
          );
        };
      }

      void lease
        .ready()
        .then((instance) => {
          for (const [name, state] of Object.entries(instance.states)) {
            const target = stateCells[name];
            if (!target) continue;
            const replicaState = state as {
              current(): unknown;
              cursor?: { generation: number };
              onChange(
                listener: (
                  value: unknown,
                  meta: { kind: 'seed' | 'update'; mutationIds?: readonly string[] }
                ) => void
              ): () => void;
            };
            target.set(replicaState.current(), {
              status: 'live',
              generation: replicaState.cursor?.generation,
            });
            scope.add(
              replicaState.onChange((value, meta) => {
                target.set(value, {
                  status: meta.kind === 'seed' ? 'stale' : 'live',
                  generation: replicaState.cursor?.generation,
                  mutationIds: meta.kind === 'update' ? meta.mutationIds : undefined,
                });
              })
            );
          }
        })
        .catch((error: unknown) => {
          for (const target of Object.values(stateCells)) {
            target.set(peek(target), {
              status: 'error',
              error,
            });
          }
        });

      return {
        states: stateCells as unknown as RemoteStates<Group>,
        mutations: mutations as ReplicaMutations<Group>,
      };
    },
    {
      lingerMs: options.lingerMs,
      clock: options.clock,
      scope: options.scope,
      name: `remote:${contract.id}`,
    }
  );

  const disposeMembers = members.dispose;
  members.dispose = async () => {
    await disposeMembers();
    await replica.dispose();
  };
  return members;
}
