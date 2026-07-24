import type { MachineStatusKind } from '@emdash/ui/react/components';
import type { ConnectionState } from '@core/primitives/ssh/api';
import type { RemoteMachineServerStatus } from '@core/services/remote-machine/api';

export function deriveMachineStatusKind({
  connectionState,
  workspaceServerStatus,
  workspaceServerLoading,
}: {
  connectionState: ConnectionState;
  workspaceServerStatus: RemoteMachineServerStatus | undefined;
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
  if (workspaceServerStatus === 'healthy') return 'successful';

  return 'error';
}
