import { LOCAL_HOST_REF, type HostRef } from '@emdash/core/primitives/host/api';
import { providerUsageContract } from '@emdash/core/runtimes/provider-usage/api';
import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import type { Scope } from '@emdash/shared/concurrency';
import { systemClock } from '@emdash/shared/scheduling';
import { createController, type ContractClient } from '@emdash/wire/rpc';
import { cell, expose, observe, remote } from '@emdash/wire/state';
import type { MachinesService } from '@core/features/machines/api/node/machines-service';
import type { HostAvailabilityService } from '@core/services/hosts/node/availability';
import type { Hosts } from '@core/services/hosts/node/hosts';
import { usageContract } from '../api/contract';
import type { UsageMachine, UsageOverview } from '../api/schemas';
import { aggregateUsage, receiveUsage } from './aggregate';

type Options = {
  scope: Scope;
  runtimes: Pick<RuntimeBroker, 'client'>;
  machines: Pick<MachinesService, 'getMachines' | 'on'>;
  hosts: Pick<Hosts, 'get' | 'onInvalidate'>;
  hostAvailability: Pick<HostAvailabilityService, 'state' | 'stateFor' | 'lease'>;
};
type Binding = {
  scope: Scope;
  generation: number;
  client?: ContractClient<typeof providerUsageContract>;
};

export function createUsageWireController(options: Options) {
  const scope = options.scope.child('usage-overview');
  const machines = new Map<string, UsageMachine>();
  const bindings = new Map<string, Binding>();
  const value = cell<UsageOverview>({ accounts: [], machines: [] });
  let demand: Scope | undefined;
  let reload: (() => Promise<void>) | undefined;
  const publish = () => value.set(aggregateUsage([...machines.values()], Date.now()));
  const detach = (id: string) => {
    const binding = bindings.get(id);
    bindings.delete(id);
    if (binding) void binding.scope.dispose();
  };
  // Clear identity-bound data even while no renderer is observing the page.
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
    if (bindings.get(id)?.generation === generation) return;
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
      if (host.type === 'remote') {
        const service = options.hosts.get(host);
        const connection = await service?.runtime.client({
          waitForReady: false,
          signal: binding.scope.signal,
        });
        if (!current()) return;
        // Minor 1 adds providerUsage. Old servers remain usable for other features.
        if ((connection?.currentHandshake()?.agreedMinor ?? 0) < 1) {
          status('upgrade-required');
          return;
        }
      }
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
            machine.providers = receiveUsage(snapshot.value, Date.now());
          }
          publish();
        },
        { scope: binding.scope }
      );
    } catch {
      status('error');
    }
  }

  const overview = expose(
    usageContract.overview,
    {
      current: (_key, owner) => {
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
              // Observation does not acquire a host lease or connect an offline machine.
              observe(
                options.hostAvailability.state(host),
                (snapshot) => {
                  const machine = machines.get(id);
                  if (!machine || watch.disposed) return;
                  const availability = snapshot.value;
                  if (availability?.kind !== 'ready') {
                    detach(id);
                    machine.status =
                      availability?.kind === 'preparing' ? 'checking' : 'disconnected';
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
                ...aggregateUsage([...machines.values()], Date.now()),
                error: 'Could not discover machines. Try refreshing.',
              });
          }
        };
        reload = load;
        owner.add(() => {
          if (demand === owner) {
            demand = undefined;
            reload = undefined;
          }
          for (const id of bindings.keys()) detach(id);
        });
        owner.run('usage-inventory', async (signal) => {
          while (!signal.aborted) {
            await load();
            await systemClock.sleep(60_000, { signal, unref: true });
          }
        });
        return value;
      },
    },
    { scope, lingerMs: 0 }
  );

  return createController(usageContract, {
    overview,
    refresh: async () => {
      if (!demand) return;
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
  });
}
