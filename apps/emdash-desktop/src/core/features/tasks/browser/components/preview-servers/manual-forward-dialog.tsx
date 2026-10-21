import { Button, Dialog, Input, Label, Select } from '@emdash/ui/react/primitives';
import { useState, type FormEvent } from 'react';
import { usePreviewServers } from '@core/features/workbench/api/browser/task-composition-context';
import type { PreviewServerProtocol } from '@core/primitives/preview-servers/api';

function parsePort(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  return port;
}

export function ManualForwardDialog({ onClose }: { onClose: () => void }) {
  const previews = usePreviewServers();
  const [protocol, setProtocol] = useState<PreviewServerProtocol>('http:');
  const [remotePort, setRemotePort] = useState('');
  const [localPort, setLocalPort] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const parsedRemotePort = parsePort(remotePort);
    const parsedLocalPort = parsePort(localPort);
    if (!parsedRemotePort) {
      setError('Enter a remote port between 1 and 65535.');
      return;
    }
    if (localPort.trim() && !parsedLocalPort) {
      setError('Enter a local port between 1 and 65535.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await previews.forwardManual({
        protocol,
        remotePort: parsedRemotePort,
        ...(parsedLocalPort ? { preferredLocalPort: parsedLocalPort } : {}),
      });
      if (!result.success) {
        switch (result.error.type) {
          case 'not-ssh-workspace':
          case 'host-unavailable':
          case 'not-configured':
          case 'project-unavailable':
          case 'open-failed':
          case 'cancelled':
            setError(result.error.message);
            break;
        }
        return;
      }
      setRemotePort('');
      setLocalPort('');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog.Content>
      <form onSubmit={handleSubmit}>
        <Dialog.Header>
          <Dialog.Title>Forward Port</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Dialog.Description>
            Create a preview tunnel from a remote dev server port.
          </Dialog.Description>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[120px_1fr]">
            <Label htmlFor="preview-protocol" className="self-center">
              Protocol
            </Label>
            <Select.Root
              value={protocol}
              onValueChange={(value) => {
                if (value) setProtocol(value as PreviewServerProtocol);
              }}
            >
              <Select.Trigger id="preview-protocol" appearance="input" className="w-full">
                <Select.Value>{protocol === 'https:' ? 'HTTPS' : 'HTTP'}</Select.Value>
              </Select.Trigger>
              <Select.Content align="start" width="trigger">
                <Select.Item value="http:">HTTP</Select.Item>
                <Select.Item value="https:">HTTPS</Select.Item>
              </Select.Content>
            </Select.Root>
            <Label htmlFor="preview-remote-port" className="self-center">
              Remote port
            </Label>
            <Input
              id="preview-remote-port"
              inputMode="numeric"
              value={remotePort}
              onChange={(event) => setRemotePort(event.target.value)}
              placeholder="5173"
            />
            <Label htmlFor="preview-local-port" className="self-center">
              Local port
            </Label>
            <Input
              id="preview-local-port"
              inputMode="numeric"
              value={localPort}
              onChange={(event) => setLocalPort(event.target.value)}
              placeholder="Auto"
            />
          </div>
          {error ? <p className="text-xs text-foreground-destructive">{error}</p> : null}
        </Dialog.Body>
        <Dialog.Footer>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Forwarding...' : 'Forward'}
          </Button>
        </Dialog.Footer>
      </form>
    </Dialog.Content>
  );
}
