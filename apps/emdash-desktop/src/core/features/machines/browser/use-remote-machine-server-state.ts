import { createLiveModelReplica } from '@emdash/wire';
import { useCallback, useEffect, useState } from 'react';
import { toast } from '@core/primitives/ui/browser/use-toast';
import {
  remoteMachineContract,
  type RemoteMachineServerRuntime,
  type RemoteMachineServerState,
} from '@core/services/remote-machine/api';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';

type ServerAction =
  | 'installServer'
  | 'startServer'
  | 'stopServer'
  | 'restartServer'
  | 'updateServer';

type RuntimeState = {
  machineId: string;
  runtime: RemoteMachineServerRuntime;
};

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
} {
  const [runtimeState, setRuntimeState] = useState<RuntimeState | null>(null);
  const [modelReady, setModelReady] = useState(false);

  useEffect(() => {
    if (!enabled || !machineId) {
      setRuntimeState(null);
      setModelReady(false);
      return;
    }

    let disposed = false;
    let cleanup: (() => void) | undefined;
    setRuntimeState(null);
    setModelReady(false);
    void (async () => {
      const client = await getDesktopWireClient();
      if (disposed) return;
      const replica = createLiveModelReplica(
        remoteMachineContract.serverStates,
        client.remoteMachine.serverStates,
        {
          onChange: {
            runtime: (runtime: RemoteMachineServerRuntime) => {
              if (!disposed) setRuntimeState({ machineId, runtime });
            },
          },
        }
      );
      const lease = replica.acquire(undefined);
      cleanup = () => {
        void lease.release();
        void replica.dispose();
      };
      const model = await lease.ready();
      if (disposed) {
        cleanup();
        return;
      }
      const runtime = (await model.states.runtime.snapshot()).data as RemoteMachineServerRuntime;
      setRuntimeState({ machineId, runtime });
      setModelReady(true);
    })().catch(() => {
      if (!disposed) setModelReady(true);
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [enabled, machineId]);

  let state: RemoteMachineServerState | undefined;
  if (connected && machineId && runtimeState?.machineId === machineId) {
    state = runtimeState.runtime[machineId];
  }

  useEffect(() => {
    if (!enabled || !connected || !machineId || !modelReady || state) return;
    let cancelled = false;
    void getDesktopWireClient()
      .then((client) => client.remoteMachine.refreshServerState({ connectionId: machineId }))
      .catch(() => {
        if (cancelled) return;
      });
    return () => {
      cancelled = true;
    };
  }, [connected, enabled, machineId, modelReady, state]);

  const runAction = useCallback(
    async (action: ServerAction, label: string) => {
      if (!machineId) return;
      try {
        const client = await getDesktopWireClient();
        await client.remoteMachine[action]({ connectionId: machineId });
      } catch (error) {
        toast({
          title: `Failed to ${label} workspace server`,
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        });
      }
    },
    [machineId]
  );

  return {
    state,
    loading: enabled && connected && (!modelReady || !state),
    install: () => runAction('installServer', 'install'),
    start: () => runAction('startServer', 'start'),
    stop: () => runAction('stopServer', 'shut down'),
    restart: () => runAction('restartServer', 'restart'),
    update: () => runAction('updateServer', 'update'),
  };
}
