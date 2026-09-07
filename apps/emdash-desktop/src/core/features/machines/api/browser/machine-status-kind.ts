import type { MachineStatusKind } from '@emdash/ui/react/components';
import type { ConnectionState } from '@core/primitives/ssh/api';

export function deriveConnectionMachineStatusKind(
  connectionState: ConnectionState
): MachineStatusKind {
  if (connectionState === 'error') return 'error';
  if (connectionState === 'connecting' || connectionState === 'reconnecting') {
    return 'initializing';
  }
  if (connectionState === 'connected') return 'successful';

  return 'idle';
}
