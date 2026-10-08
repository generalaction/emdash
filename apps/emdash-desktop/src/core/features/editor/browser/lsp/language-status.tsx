import type { HostFileRef } from '@emdash/core/primitives/path/api';
import { Button } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { getLanguageServices } from './language-services';

export const LanguageStatus = observer(function LanguageStatus({ file }: { file: HostFileRef }) {
  const services = getLanguageServices();
  const status = services?.status(file);
  if (!status) return null;
  const { connection } = status;
  const server = connection.kind === 'connected' ? connection.server : undefined;
  const starting = connection.kind === 'connecting' || server?.phase === 'starting';
  const unavailable = connection.kind === 'disconnected' || server?.phase === 'failed';
  const error = connection.kind === 'disconnected' ? connection.message : server?.error;
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={starting}
      title={error ?? `Restart ${status.serverName} language services`}
      aria-label={
        error ? `Language services unavailable: ${error}. Retry` : 'Restart language services'
      }
      onClick={() => {
        void services?.restartServer(file);
      }}
    >
      {connection.kind === 'connecting'
        ? 'Connecting language services…'
        : starting
          ? 'Starting language services…'
          : unavailable
            ? 'Language services unavailable · Retry'
            : status.serverName}
    </Button>
  );
});
