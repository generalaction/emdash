import type { MachineStatusKind } from '@emdash/ui/react/components';
import type { ConnectionState } from '@core/primitives/ssh/api';
import type { RemoteMachineServerStatus } from '@core/services/hosts/api';

export function deriveMachineStatusKind({
  connectionState,
  workspaceServerStatus,
  workspaceServerError,
  workspaceServerLoading,
}: {
  connectionState: ConnectionState;
  workspaceServerStatus: RemoteMachineServerStatus | undefined;
  workspaceServerError?: boolean;
  workspaceServerLoading: boolean;
}): MachineStatusKind {
  if (connectionState === 'error') return 'error';
  if (connectionState === 'connecting' || connectionState === 'reconnecting') {
    return 'initializing';
  }
  if (connectionState === 'disconnected') return 'idle';

  if (
    workspaceServerLoading ||
    workspaceServerStatus === 'booting' ||
    workspaceServerStatus === 'shutting-down'
  ) {
    return 'initializing';
  }
  if (workspaceServerError) return 'error';
  if (workspaceServerStatus === 'healthy') return 'successful';

  return 'error';
}
