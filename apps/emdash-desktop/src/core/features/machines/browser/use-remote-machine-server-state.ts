import { toast } from '@emdash/ui/react/primitives';
import { remote, type RemoteModel } from '@emdash/wire/state';
import { useCallback, useEffect } from 'react';
import { useRemoteModelState } from '@core/primitives/wire/browser/use-remote-model-state';
import {
  remoteMachineContract,
  type RemoteMachineServerState,
} from '@core/services/remote-machine/api';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';

type ServerAction =
  | 'installServer'
  | 'startServer'
  | 'stopServer'
  | 'restartServer'
  | 'updateServer';

let serverStatesRemotePromise:
  | Promise<RemoteModel<typeof remoteMachineContract.serverStates>>
  | undefined;

export function useRemoteMachineServerState({
  machineId,
  enabled,
  connected,
}: {
  machineId: string | undefined;
  enabled: boolean;
  connected: boolean;
}): {
  state: RemoteMachineServerState | undefined;
  loading: boolean;
  install(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  update(): Promise<void>;
  refresh(): Promise<void>;
} {
  const runtimeState = useRemoteModelState(
    remoteMachineContract.serverStates,
    getServerStatesRemote,
    undefined,
    'runtime',
    {
      enabled: enabled && machineId !== undefined,
      initialValue: {},
    }
  );

  let state: RemoteMachineServerState | undefined;
  if (connected && machineId) {
    state = runtimeState.value?.[machineId];
  }

  useEffect(() => {
    if (!enabled || !connected || !machineId || !runtimeState.ready) return;
    if (hasRecentLatestVersion(state)) return;
    let cancelled = false;
    void getDesktopWireClient()
      .then((client) => client.remoteMachine.refreshServerState({ connectionId: machineId }))
      .catch(() => {
        if (cancelled) return;
      });
    return () => {
      cancelled = true;
    };
  }, [connected, enabled, machineId, runtimeState.ready, state]);

  const runAction = useCallback(
    async (action: ServerAction, label: string) => {
      if (!machineId) return;
      try {
        const client = await getDesktopWireClient();
        await client.remoteMachine[action]({ connectionId: machineId });
      } catch (error) {
        toast.error(`Failed to ${label} workspace server`, {
          description: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [machineId]
  );

  const refresh = useCallback(async () => {
    if (!machineId) return;
    try {
      const client = await getDesktopWireClient();
      await client.remoteMachine.refreshServerState({ connectionId: machineId, force: true });
    } catch (error) {
      toast.error('Failed to check workspace server updates', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [machineId]);

  return {
    state,
    loading: enabled && connected && (!runtimeState.ready || !state),
    install: () => runAction('installServer', 'install'),
    start: () => runAction('startServer', 'start'),
    stop: () => runAction('stopServer', 'shut down'),
    restart: () => runAction('restartServer', 'restart'),
    update: () => runAction('updateServer', 'update'),
    refresh,
  };
}

function hasRecentLatestVersion(state: RemoteMachineServerState | undefined): boolean {
  return state?.latestVersion !== undefined;
}

function getServerStatesRemote(): Promise<RemoteModel<typeof remoteMachineContract.serverStates>> {
  serverStatesRemotePromise ??= getDesktopWireClient().then((client) =>
    remote(remoteMachineContract.serverStates, client.remoteMachine.serverStates, {
      lingerMs: 15_000,
    })
  );
  return serverStatesRemotePromise;
}

export async function resetRemoteMachineServerStateForTests(): Promise<void> {
  const remoteModel = await serverStatesRemotePromise;
  serverStatesRemotePromise = undefined;
  await remoteModel?.dispose();
}
