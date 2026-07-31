import { createMachine, createScope, type MachineDefinition } from '@emdash/shared/concurrency';
import { ok } from '@emdash/shared/result';
import { describe, expect, it } from 'vitest';
import { flushStateTurn, observe, snapshot } from './core';
import { fromMachine } from './from-machine';

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

function setupCounter() {
  const scope = createScope({ label: 'from-machine-test' });
  const machine = createMachine(definition, { count: 0 });
  const binding = fromMachine({
    scope,
    machine,
    project: (state) => ({ count: state.count }),
  });
  return { scope, machine, binding };
}

describe('fromMachine', () => {
  it('seeds state from the machine projection', async () => {
    const { scope, binding } = setupCounter();

    expect(snapshot(binding.state).value).toEqual({ count: 0 });
    await scope.dispose();
  });

  it('publishes dispatch transitions to the cell', async () => {
    const { scope, machine, binding } = setupCounter();

    machine.dispatch({ type: 'add', by: 2 }, undefined);

    expect(snapshot(binding.state).value).toEqual({ count: 2 });
    await scope.dispose();
  });

  it('suppresses updates when the projection is unchanged', async () => {
    const scope = createScope({ label: 'from-machine-test' });
    const machine = createMachine(definition, { count: 0 });
    const binding = fromMachine({
      scope,
      machine,
      project: (state) => (state.count % 2 === 0 ? 'even' : 'odd'),
    });
    const initialRevision = snapshot(binding.state).revision;

    machine.dispatch({ type: 'add', by: 2 }, undefined);

    expect(snapshot(binding.state)).toMatchObject({
      value: 'even',
      revision: initialRevision,
    });
    await scope.dispose();
  });

  it('supports manual sync', async () => {
    const { scope, machine, binding } = setupCounter();
    await scope.dispose();
    machine.replace({ count: 5 });

    binding.sync();

    expect(snapshot(binding.state).value).toEqual({ count: 5 });
  });

  it('stops publishing after scope disposal', async () => {
    const { scope, machine, binding } = setupCounter();
    await scope.dispose();

    machine.dispatch({ type: 'add', by: 1 }, undefined);

    expect(snapshot(binding.state).value).toEqual({ count: 0 });
  });

  it('can filter transition batches', async () => {
    const scope = createScope({ label: 'from-machine-test' });
    const machine = createMachine(definition, { count: 0 });
    const binding = fromMachine({
      scope,
      machine,
      project: (state) => ({ count: state.count }),
      shouldPublish: (batch) => batch.effects.some((effect) => effect.value >= 2),
    });

    machine.dispatch({ type: 'add', by: 1 }, undefined);
    expect(snapshot(binding.state).value).toEqual({ count: 0 });

    machine.dispatch({ type: 'add', by: 1 }, undefined);
    expect(snapshot(binding.state).value).toEqual({ count: 2 });

    await scope.dispose();
  });

  it('notifies observers when projected state changes', async () => {
    const { scope, machine, binding } = setupCounter();
    const values: State[] = [];
    observe(
      binding.state,
      (current) => {
        values.push(current.value);
      },
      { scope }
    );

    machine.dispatch({ type: 'add', by: 1 }, undefined);
    flushStateTurn();

    expect(values).toEqual([{ count: 0 }, { count: 1 }]);
    await scope.dispose();
  });
});
