import { isDeepEqual } from '@emdash/shared';
import { cell, expose, peek, produce, type Cell, type LeasedLiveModelProvider } from '@emdash/wire';
import {
  remoteMachineContract,
  type RemoteMachineServerRuntime,
  type RemoteMachineServerState,
} from '../api';

export class RemoteMachineStateModel {
  readonly runtime: Cell<RemoteMachineServerRuntime>;
  readonly host: LeasedLiveModelProvider<typeof remoteMachineContract.serverStates>;

  constructor() {
    this.runtime = cell<RemoteMachineServerRuntime>({});
    this.host = expose(remoteMachineContract.serverStates, { runtime: this.runtime });
  }

  set(connectionId: string, state: RemoteMachineServerState): void {
    this.runtime.set(
      produce(peek(this.runtime), (runtime) => {
        // Assigning a fresh deep-equal object would still produce a patch; skip
        // the write so identical states never emit updates to subscribers.
        if (isDeepEqual(runtime[connectionId], state)) return;
        runtime[connectionId] = state;
      })
    );
  }

  get(connectionId: string): RemoteMachineServerState | undefined {
    return peek(this.runtime)[connectionId];
  }

  remove(connectionId: string): void {
    this.runtime.set(
      produce(peek(this.runtime), (runtime) => {
        delete runtime[connectionId];
      })
    );
  }

  markConnectionLost(connectionId: string): void {
    this.runtime.set(
      produce(peek(this.runtime), (runtime) => {
        const current = runtime[connectionId];
        if (current?.status !== 'healthy') return;
        runtime[connectionId] = {
          status: 'stopped',
          version: current.version,
          latestVersion: current.latestVersion,
        };
      })
    );
  }

  snapshot(): RemoteMachineServerRuntime {
    return peek(this.runtime);
  }

  dispose(): void {
    void this.host.dispose();
  }
}
