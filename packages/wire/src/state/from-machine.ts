import { isDeepEqual } from '@emdash/shared';
import type { Machine, MachineBatch, Scope } from '@emdash/shared/concurrency';
import { cell, type Cell, type Revision, type StateInstrumentation } from './core';

export type MachineStateSource<State, Command, Event, Effect> = Pick<
  Machine<State, Command, Event, Effect, unknown, unknown>,
  'current' | 'subscribe'
>;

export type FromMachineOptions<State, View, Command, Event, Effect> = {
  scope: Scope;
  machine: MachineStateSource<State, Command, Event, Effect>;
  project(state: State): View;
  shouldPublish?: (batch: MachineBatch<State, Command, Event, Effect>) => boolean;
  equals?: (left: View, right: View) => boolean;
  name?: string;
  instrumentation?: StateInstrumentation;
};

export type MachineStateBinding<View> = {
  readonly state: Cell<View>;
  sync(): Revision;
};

export function fromMachine<State, View, Command, Event, Effect>(
  options: FromMachineOptions<State, View, Command, Event, Effect>
): MachineStateBinding<View> {
  const state = cell(options.project(options.machine.current()), {
    equals: options.equals ?? isDeepEqual,
    name: options.name,
    instrumentation: options.instrumentation,
  });

  const sync = () => state.set(options.project(options.machine.current()));
  options.scope.add(
    options.machine.subscribe((batch) => {
      if (options.shouldPublish && !options.shouldPublish(batch)) return;
      sync();
    })
  );

  return { state, sync };
}
