import { Pill } from '@emdash/ui/react/components';
import type { RemoteMachineServerStatus } from '@core/services/remote-machine/api';

const statusLabels: Record<RemoteMachineServerStatus, string> = {
  'not-installed': 'Not found',
  stopped: 'Stopped',
  booting: 'Booting',
  'shutting-down': 'Shutting Down',
  healthy: 'Healthy',
  failed: 'Error',
};

function variantForStatus(status: RemoteMachineServerStatus): {
  variant: 'neutral' | 'success' | 'info' | 'error';
  pulsing: boolean;
} {
  if (status === 'healthy') {
    return { variant: 'success', pulsing: false };
  }
  if (status === 'booting' || status === 'shutting-down') {
    return { variant: 'info', pulsing: true };
  }
  if (status === 'failed') {
    return { variant: 'error', pulsing: false };
  }
  return { variant: 'neutral', pulsing: false };
}

export function WorkspaceServerBadge({ status }: { status: RemoteMachineServerStatus }) {
  const { variant, pulsing } = variantForStatus(status);

  return (
    <Pill variant={variant} dot pulsing={pulsing}>
      {statusLabels[status]}
    </Pill>
  );
}
