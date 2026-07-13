import { createMachine, type MachineDefinition } from '@emdash/shared/concurrency';
import { ok } from '@emdash/shared/result';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LiveStateClient, type LiveChangeMeta } from './client';
import { bindMachineToLiveState } from './machine-binding';
import { LiveState } from './server';

type State = { count: number };
type Command = { type: 'add'; by: number };
type Event = { type: 'Added'; by: number };
type Effect = { type: 'count'; value: number };

const definition: MachineDefinition<State, Command, Event, Effect, never> = {
  decide(_state, command) {
    return ok([{ type: 'Added', by: command.by }]);
  },
  evolve(state, event) {
    const next = { count: state.count + event.by };
    return { state: next, effects: [{ type: 'count', value: next.count }] };
  },
};

const counterSchema = z.object({ count: z.number() });

function setupCounter() {
  const machine = createMachine(definition, { count: 0 });
  const server = new LiveState<{ count: number }>({ count: -1 }, 1000);
  const onChange = vi.fn<(value: { count: number }, meta: LiveChangeMeta) => void>();
  const client = new LiveStateClient(counterSchema, async () => server.snapshot(), onChange);
  client.seed(server.snapshot());
  server.subscribe((update) => client.applyUpdate(update));
  const binding = bindMachineToLiveState({
    machine,
    liveState: server,
    project: (state) => ({ count: state.count }),
  });
  return { machine, server, client, onChange, binding };
}

describe('bindMachineToLiveState', () => {
  it('seeds LiveState from the machine projection', () => {
    const { client } = setupCounter();

    expect(client.getSnapshot()).toEqual({ count: 0 });
  });

  it('publishes dispatch transitions to LiveState clients', () => {
    const { machine, client, onChange } = setupCounter();

    machine.dispatch({ type: 'add', by: 2 }, undefined);

    expect(client.getSnapshot()).toEqual({ count: 2 });
    expect(onChange).toHaveBeenLastCalledWith({ count: 2 }, { kind: 'update', mutationIds: [] });
  });

  it('suppresses LiveState updates when the projection is unchanged', () => {
    const machine = createMachine(definition, { count: 0 });
    const server = new LiveState<string>('even', 1000);
    const updates: unknown[] = [];
    server.subscribe((update) => updates.push(update));
    bindMachineToLiveState({
      machine,
      liveState: server,
      project: (state) => (state.count % 2 === 0 ? 'even' : 'odd'),
    });

    machine.dispatch({ type: 'add', by: 2 }, undefined);

    expect(server.cursor).toEqual({ generation: 1000, sequence: 0 });
    expect(updates).toEqual([]);
  });

  it('supports manual sync', () => {
    const { machine, server, binding } = setupCounter();
    machine.replace({ count: 5 });
    expect(server.snapshot().data).toEqual({ count: 5 });

    binding.sync();

    expect(server.snapshot().data).toEqual({ count: 5 });
  });

  it('stops publishing after disposal', () => {
    const { machine, client, binding } = setupCounter();
    binding.dispose();

    machine.dispatch({ type: 'add', by: 1 }, undefined);

    expect(client.getSnapshot()).toEqual({ count: 0 });
  });

  it('can filter transition batches', () => {
    const machine = createMachine(definition, { count: 0 });
    const server = new LiveState<{ count: number }>({ count: 0 }, 1000);
    bindMachineToLiveState({
      machine,
      liveState: server,
      project: (state) => ({ count: state.count }),
      shouldPublish: (batch) => batch.effects.some((effect) => effect.value >= 2),
    });

    machine.dispatch({ type: 'add', by: 1 }, undefined);
    expect(server.snapshot().data).toEqual({ count: 0 });

    machine.dispatch({ type: 'add', by: 1 }, undefined);
    expect(server.snapshot().data).toEqual({ count: 2 });
  });
});
