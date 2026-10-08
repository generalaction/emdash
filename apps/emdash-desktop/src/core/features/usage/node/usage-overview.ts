import { LOCAL_HOST_REF, type HostRef } from '@emdash/core/primitives/host/api';
import { providerUsageContract } from '@emdash/core/runtimes/provider-usage/api';
import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import type { Scope } from '@emdash/shared/concurrency';
import { systemClock, type Clock } from '@emdash/shared/scheduling';
import type { ContractClient } from '@emdash/wire/rpc';
import { cell, family, observe, remote, type Readable } from '@emdash/wire/state';
import type { MachinesService } from '@core/features/machines/api/node/machines-service';
import type { HostAvailabilityService } from '@core/services/hosts/node/availability';
import type { Hosts } from '@core/services/hosts/node/hosts';
import type { UsageMachine, UsageOverview } from '../api/schemas';
import { aggregateUsage, receiveUsage } from './aggregate';

type Options = {
  scope: Scope;
  clock?: Clock;
  runtimes: Pick<RuntimeBroker, 'client'>;
  machines: Pick<MachinesService, 'getMachines' | 'on'>;
  hosts: Pick<Hosts, 'onInvalidate'>;
  hostAvailability: Pick<HostAvailabilityService, 'state' | 'stateFor' | 'lease'>;
};
type Binding = {
  scope: Scope;
  generation: number;
  client?: ContractClient<typeof providerUsageContract>;
};

export type UsageOverviewSource = {
  observe(owner: Scope): Readable<UsageOverview>;
  refresh(): Promise<void>;
};

/** Retains readings for the app lifetime and collects only while an observer owns demand. */
export function createUsageOverview(options: Options): UsageOverviewSource {
  const scope = options.scope.child('usage-overview');
  const clock = options.clock ?? systemClock;
  const machines = new Map<string, UsageMachine>();
  const bindings = new Map<string, Binding>();
  const value = cell<UsageOverview>({ accounts: [], machines: [] });
  let demand: Scope | undefined;
  let reload: (() => Promise<void>) | undefined;
  const publish = () => value.set(aggregateUsage([...machines.values()], clock.now()));
  const detach = (id: string) => {
    const binding = bindings.get(id);
    bindings.delete(id);
    if (binding) void binding.scope.dispose();
  };
  scope.add(
    options.hosts.onInvalidate((event) => {
      if (event.reason === 'machine-mutation') {
        detach(event.connectionId);
        machines.delete(event.connectionId);
        publish();
      }
    })
  );
  scope.add(
    options.machines.on('machine:mutated', () => {
      void reload?.();
    })
  );

  async function attach(id: string, host: HostRef, generation: number, owner: Scope) {
    const existing = bindings.get(id);
    if (existing?.generation === generation && !existing.scope.disposed) return;
    detach(id);
    const binding: Binding = { scope: owner.child(`usage:${id}`), generation };
    bindings.set(id, binding);
    const current = () =>
      !binding.scope.disposed && bindings.get(id) === binding && machines.has(id);
    const status = (status: UsageMachine['status']) => {
      const machine = machines.get(id);
      if (current() && machine) {
        machine.status = status;
        publish();
      }
    };
    status('checking');
    try {
      const result = await options.runtimes.client(host);
      if (!current()) return;
      if (!result.success) {
        status('error');
        return;
      }
      binding.client = result.data.providerUsage;
      const model = remote(providerUsageContract.snapshot, binding.client.snapshot, {
        scope: binding.scope,
        lingerMs: 15_000,
      });
      observe(
        model(undefined).states.current,
        (snapshot) => {
          if (!current()) return;
          const machine = machines.get(id);
          if (!machine) return;
          if (snapshot.status === 'error') machine.status = 'error';
          else if (snapshot.value) {
            machine.status = 'connected';
            machine.providers = receiveUsage(snapshot.value, clock.now());
          }
          publish();
        },
        { scope: binding.scope }
      );
    } catch {
      status('error');
    }
  }

  const collection = family(
    (_key: void, owner) => {
      demand = owner;
      options.hostAvailability.lease(LOCAL_HOST_REF, owner);
      const observers = new Map<string, Scope>();
      let revision = 0;
      const load = async () => {
        const version = ++revision;
        try {
          const remoteMachines = await options.machines.getMachines();
          if (owner.disposed || version !== revision) return;
          const inventory = [
            { id: 'local', name: 'This machine', host: LOCAL_HOST_REF },
            ...remoteMachines.map((machine) => ({
              id: machine.id,
              name: machine.name ?? machine.host,
              host: { type: 'remote', id: machine.id } as const,
            })),
          ];
          const ids = new Set(inventory.map((machine) => machine.id));
          for (const id of new Set([...machines.keys(), ...observers.keys()]))
            if (!ids.has(id)) {
              machines.delete(id);
              detach(id);
              void observers.get(id)?.dispose();
              observers.delete(id);
            }
          for (const { id, name, host } of inventory) {
            const previous = machines.get(id);
            machines.set(id, {
              id,
              name,
              status: previous?.status ?? 'checking',
              providers: previous?.providers ?? [],
            });
            if (observers.has(id)) {
              if (previous?.status === 'error' || !previous) {
                detach(id);
                const availability = options.hostAvailability.stateFor(host);
                if (availability.kind === 'ready')
                  void attach(id, host, availability.generation, owner);
              }
              continue;
            }
            const watch = owner.child(`usage-availability:${id}`);
            observers.set(id, watch);
            observe(
              options.hostAvailability.state(host),
              (snapshot) => {
                const machine = machines.get(id);
                if (!machine || watch.disposed) return;
                const availability = snapshot.value;
                if (availability?.kind !== 'ready') {
                  detach(id);
                  machine.status = availability?.kind === 'preparing' ? 'checking' : 'disconnected';
                  publish();
                  return;
                }
                void attach(id, host, availability.generation, owner);
              },
              { scope: watch }
            );
          }
          publish();
        } catch {
          if (!owner.disposed)
            value.set({
              ...aggregateUsage([...machines.values()], clock.now()),
              error: 'Could not discover machines. Try refreshing.',
            });
        }
      };
      reload = load;
      owner.add(() => {
        if (demand !== owner) return;
        demand = undefined;
        reload = undefined;
        for (const id of bindings.keys()) detach(id);
      });
      owner.run('usage-inventory', async (signal) => {
        while (!signal.aborted) {
          await load();
          await clock.sleep(60_000, { signal, unref: true });
        }
      });
      return value;
    },
    { scope, name: 'usage-collection', lingerMs: 0 }
  );

  return {
    observe(owner) {
      owner.add(collection.retain(undefined));
      return collection(undefined);
    },
    refresh: async () => {
      if (!demand || demand.disposed) return;
      await reload?.();
      await Promise.all(
        [...bindings.entries()].map(async ([id, binding]) => {
          if (!binding.client) return;
          try {
            await binding.client.refresh(undefined, {
              signal: binding.scope.signal,
              timeoutMs: 40_000,
            });
          } catch {
            const machine = machines.get(id);
            if (machine && bindings.get(id) === binding) {
              machine.status = 'error';
              publish();
            }
          }
        })
      );
    },
  };
}
