import type { MachineStatusKind } from '@emdash/ui/react/components';
import type { ConnectionState } from '@core/primitives/ssh/api';
import { deriveMachineStatusKind } from './components/machine-status-kind';
import { useHostServerState } from './use-host-server-state';

export function useMachineStatusKind({
  machineId,
  connectionState,
}: {
  machineId: string | undefined;
  connectionState: ConnectionState;
}): MachineStatusKind {
  const connected = connectionState === 'connected';
  const workspaceServer = useHostServerState({
    machineId,
    enabled: !!machineId && connected,
    connected,
  });

  return deriveMachineStatusKind({
    connectionState,
    workspaceServerStatus: workspaceServer.state?.status,
    workspaceServerError: workspaceServer.state?.error !== undefined,
    workspaceServerLoading: workspaceServer.loading,
  });
}
