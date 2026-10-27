import type { Unsubscribe } from '@agent/shared';
import type { Scope } from '@agent/shared/concurrency';
import type { Readable, Snapshot } from './node';

export type ObserveOptions = {
  scope: Scope;
  immediate?: boolean;
};

export function observe<T>(
  node: Readable<T>,
  listener: (snapshot: Snapshot<T>) => void,
  options: ObserveOptions
): void {
  const unsubscribe = node.__stateNode.observe((current) => listener(current as Snapshot<T>), {
    immediate: options.immediate,
  }) as Unsubscribe;
  options.scope.add(unsubscribe);
}
