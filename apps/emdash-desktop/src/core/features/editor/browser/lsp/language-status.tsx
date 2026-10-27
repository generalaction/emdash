import type { HostFileRef } from '@emdash/core/primitives/path/api';
import { Button, Dialog } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { defineModal } from '@core/primitives/modals/react';
import { getLanguageServices } from './language-services';

/** Details are shown on demand from the file tab menu, never in the file header. */
export const LanguageStatus = observer(function LanguageStatus({ file }: { file: HostFileRef }) {
  const services = getLanguageServices();
  const status = services?.status(file);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string>();
  if (!status) return <Dialog.Body>Language services are not available for this file.</Dialog.Body>;
  const { connection } = status;
  const server = connection.kind === 'connected' ? connection.server : undefined;
  const starting = connection.kind === 'connecting' || server?.phase === 'starting';
  const unavailable = connection.kind === 'disconnected' || server?.phase === 'failed';
  const error = connection.kind === 'disconnected' ? connection.message : server?.error;
  const basic = status.fallbackAvailable && (starting || unavailable);
  return (
    <>
      <Dialog.Body>
        <p>{status.serverName}</p>
        <p className="text-foreground-passive">
          {basic
            ? 'Basic support is available for loaded files. Full project support is unavailable.'
            : starting
              ? 'Connecting language services…'
              : unavailable
                ? 'Language services unavailable.'
                : 'Language services are ready.'}
        </p>
        {error && <p className="break-words text-foreground-passive">{error}</p>}
        {restartError && <p role="alert">{restartError}</p>}
      </Dialog.Body>
      <Dialog.Footer>
        <Button
          variant="secondary"
          size="sm"
          disabled={starting || restarting}
          onClick={async () => {
            setRestarting(true);
            setRestartError(undefined);
            try {
              await services?.restartServer(file);
            } catch (error) {
              setRestartError(
                error instanceof Error ? error.message : 'Could not restart language services.'
              );
            } finally {
              setRestarting(false);
            }
          }}
        >
          {starting || restarting
            ? 'Connecting…'
            : unavailable
              ? 'Retry'
              : 'Restart language services'}
        </Button>
      </Dialog.Footer>
    </>
  );
});

function LanguageServicesDialog({ file }: { file: HostFileRef }) {
  return (
    <>
      <Dialog.Header>
        <Dialog.Title>Language services</Dialog.Title>
        <Dialog.Description>Project intelligence for this file’s workspace.</Dialog.Description>
      </Dialog.Header>
      <LanguageStatus file={file} />
    </>
  );
}

export const languageServicesDialog = defineModal<void>()({
  id: 'languageServicesDialog',
  component: LanguageServicesDialog,
  size: 'sm',
});
