import type { HostFileRef } from '@emdash/core/primitives/path/api';
import { Button } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { getLanguageServices } from './language-services';

export const LanguageStatus = observer(function LanguageStatus({ file }: { file: HostFileRef }) {
  const services = getLanguageServices();
  const status = services?.status(file);
  if (!status) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={status.phase === 'starting'}
      title={status.error ?? `Restart ${status.serverName} language services`}
      aria-label={
        status.error
          ? `Language services unavailable: ${status.error}. Retry`
          : 'Restart language services'
      }
      onClick={() => {
        void services?.restartServer(file);
      }}
    >
      {status.phase === 'starting'
        ? 'Starting language services…'
        : status.phase === 'failed'
          ? 'Language services unavailable · Retry'
          : status.serverName}
    </Button>
  );
});
