import { isDeepEqual } from '@emdash/shared';
import { createLiveModelHost, type LiveInstance, type LiveModelHost } from '@emdash/wire';
import {
  remoteMachineContract,
  type RemoteMachineServerRuntime,
  type RemoteMachineServerState,
} from '../api';

export class RemoteMachineStateModel {
  readonly host: LiveModelHost<typeof remoteMachineContract.serverStates>;
  readonly instance: LiveInstance<typeof remoteMachineContract.serverStates>;

  constructor() {
    this.host = createLiveModelHost(remoteMachineContract.serverStates);
    this.instance = this.host.create(undefined, { runtime: {} });
  }

  set(connectionId: string, state: RemoteMachineServerState): void {
    this.instance.states.runtime.produce((runtime: RemoteMachineServerRuntime) => {
      // Assigning a fresh deep-equal object would still produce a patch; skip
      // the write so identical states never emit updates to subscribers.
      if (isDeepEqual(runtime[connectionId], state)) return;
      runtime[connectionId] = state;
    });
  }

  remove(connectionId: string): void {
    this.instance.states.runtime.produce((runtime: RemoteMachineServerRuntime) => {
      delete runtime[connectionId];
    });
  }

  markConnectionLost(connectionId: string): void {
    this.instance.states.runtime.produce((runtime: RemoteMachineServerRuntime) => {
      const current = runtime[connectionId];
      if (current?.status !== 'healthy') return;
      runtime[connectionId] = {
        status: 'stopped',
        version: current.version,
      };
    });
  }

  dispose(): void {
    this.host.dispose();
  }
}
