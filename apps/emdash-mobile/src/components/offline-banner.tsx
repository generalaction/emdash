import { RefreshCw, WifiOff } from 'lucide-react';
import type { ConnectionStatus } from '../client/types';

export function OfflineBanner({
  status,
  onReconnect,
}: {
  status: ConnectionStatus;
  onReconnect: () => void;
}) {
  if (status === 'online') return null;
  const offline = status === 'offline';
  return (
    <div className="connection-banner" role="status">
      {offline ? <WifiOff size={15} /> : <span className="spinner small" />}
      <span>{offline ? 'Desktop connection lost' : 'Reconnecting to desktop…'}</span>
      {offline && (
        <button type="button" onClick={onReconnect} aria-label="Reconnect">
          <RefreshCw size={15} />
          Retry
        </button>
      )}
    </div>
  );
}
