import type { Unsubscribe } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import { cell, type Cell, type StateInstrumentation } from './core';

export type PushSource<T> = {
  current(): T;
  subscribe(listener: (value: T) => void): Unsubscribe;
};

export type FromSourceOptions<T> = {
  scope: Scope;
  equals?: (left: T, right: T) => boolean;
  name?: string;
  instrumentation?: StateInstrumentation;
};

export function fromSource<T>(source: PushSource<T>, options: FromSourceOptions<T>): Cell<T> {
  const state = cell(source.current(), {
    equals: options.equals,
    name: options.name,
    instrumentation: options.instrumentation,
  });
  options.scope.add(
    source.subscribe((value) => {
      state.set(value);
    })
  );
  return state;
}
