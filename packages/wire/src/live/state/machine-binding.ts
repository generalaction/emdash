import { isDeepEqual } from '@emdash/shared';
import type { Machine, MachineBatch } from '@emdash/shared/concurrency';
import type { LiveState } from './server';

export type MachineStateSource<State, Command, Event, Effect> = Pick<
  Machine<State, Command, Event, Effect, unknown, unknown>,
  'current' | 'subscribe'
>;

export type BindMachineToLiveStateOptions<State, View, Command, Event, Effect> = {
  machine: MachineStateSource<State, Command, Event, Effect>;
  liveState: LiveState<View>;
  project(state: State): View;
  publish?: (args: {
    liveState: LiveState<View>;
    view: View;
    batch: MachineBatch<State, Command, Event, Effect> | undefined;
  }) => void;
  shouldPublish?: (batch: MachineBatch<State, Command, Event, Effect>) => boolean;
};

export type MachineLiveStateBinding = {
  sync(): void;
  dispose(): void;
};

export function bindMachineToLiveState<State, View, Command, Event, Effect>(
  options: BindMachineToLiveStateOptions<State, View, Command, Event, Effect>
): MachineLiveStateBinding {
  let disposed = false;
  const publish = options.publish ?? defaultPublish;

  const sync = (batch?: MachineBatch<State, Command, Event, Effect>) => {
    if (disposed) return;
    const view = options.project(options.machine.current());
    if (isDeepEqual(options.liveState.snapshot().data, view)) return;
    publish({
      liveState: options.liveState,
      view,
      batch,
    });
  };

  sync();
  const unsubscribe = options.machine.subscribe((batch) => {
    if (options.shouldPublish && !options.shouldPublish(batch)) return;
    sync(batch);
  });

  return {
    sync() {
      sync();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
    },
  };
}

function defaultPublish<View>({
  liveState,
  view,
}: {
  liveState: LiveState<View>;
  view: View;
}): void {
  liveState.replace(view);
}
