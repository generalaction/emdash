import { Button, Checkbox, Dialog, ModalLayout } from '@emdash/ui/react/primitives';
import { useEffect, useState } from 'react';
import { useModalController } from '@core/manifests/browser/modal-api';
import { defineModal } from '@core/primitives/modals/react';
import type { HostTrustPrompt } from '@core/services/ssh/api/host-trust';

export function HostTrustModal({
  prompt,
  signal,
}: {
  prompt: HostTrustPrompt;
  signal: AbortSignal;
}) {
  const { complete, dismiss } = useModalController('sshHostTrustModal');
  const [verified, setVerified] = useState(false);
  const changed = prompt.kind === 'changed';
  useEffect(() => {
    if (signal.aborted) dismiss();
    signal.addEventListener('abort', dismiss, { once: true });
    return () => signal.removeEventListener('abort', dismiss);
  }, [signal, dismiss]);

  return (
    <ModalLayout
      header={
        <Dialog.Header showCloseButton>
          <Dialog.Title>{changed ? 'SSH host key changed' : 'Trust this SSH host?'}</Dialog.Title>
        </Dialog.Header>
      }
      footer={
        <Dialog.Footer>
          <Button variant="secondary" onClick={dismiss} autoFocus>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={signal.aborted || (changed && !verified)}
            onClick={() => {
              if (!signal.aborted) complete(true);
            }}
          >
            {changed ? 'Replace key and reconnect' : 'Trust and connect'}
          </Button>
        </Dialog.Footer>
      }
    >
      <Dialog.Body className="flex flex-col gap-4 text-sm">
        <p className="font-medium break-all">{prompt.destination}</p>
        {prompt.kind === 'changed' ? (
          <>
            <p>
              This machine is presenting a different identity. It may have been rebuilt, or someone
              could be intercepting the connection. Verify the new fingerprint with the machine’s
              administrator through another channel before continuing.
            </p>
            <dl className="flex flex-col gap-2">
              <dt className="text-foreground-muted">Previously trusted</dt>
              {prompt.previousFingerprints.map((fingerprint) => (
                <dd key={fingerprint} className="font-mono break-all">
                  {fingerprint}
                </dd>
              ))}
              <dt className="text-foreground-muted">New fingerprint</dt>
              <dd className="font-mono break-all">{prompt.fingerprint}</dd>
            </dl>
            <p className="break-all text-foreground-muted">
              Replace the saved keys for {prompt.host} in {prompt.knownHostsFile} and reconnect.
            </p>
            <label className="flex items-start gap-2">
              <Checkbox
                checked={verified}
                onCheckedChange={(checked) => setVerified(checked === true)}
              />
              I verified this fingerprint with the machine’s administrator.
            </label>
          </>
        ) : (
          <>
            <p>
              Verify this fingerprint with the machine’s administrator before trusting it. OpenSSH
              will remember your choice for future connections.
            </p>
            <pre className="rounded-md bg-background-2 p-3 text-xs break-all whitespace-pre-wrap">
              {prompt.prompt}
            </pre>
          </>
        )}
      </Dialog.Body>
    </ModalLayout>
  );
}

export const hostTrustModal = defineModal<boolean>()({
  id: 'sshHostTrustModal',
  component: HostTrustModal,
  size: 'md',
});
