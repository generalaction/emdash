import { Pill } from '@emdash/ui/react/components';
import type { ConnectionState } from '@core/primitives/ssh/api';
import { stateLabel } from './machine-formatters';

function toneForState(state: ConnectionState): {
  tone: 'neutral' | 'success' | 'info' | 'error';
  pulsing: boolean;
} {
  if (state === 'connected') {
    return { tone: 'success', pulsing: false };
  }
  if (state === 'connecting' || state === 'reconnecting') {
    return { tone: 'info', pulsing: true };
  }
  if (state === 'error') {
    return { tone: 'error', pulsing: false };
  }
  return { tone: 'neutral', pulsing: false };
}

export function MachineBadge({ state }: { state: ConnectionState }) {
  const { tone, pulsing } = toneForState(state);

  return (
    <Pill tone={tone} dot pulsing={pulsing}>
      {stateLabel(state)}
    </Pill>
  );
}
