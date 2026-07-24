import { useState, type FormEvent } from 'react';
import { usePreviewServers } from '@core/features/workbench/api/browser/task-composition-context';
import type { PreviewServerProtocol } from '@core/primitives/preview-servers/api';
import { Button } from '@core/primitives/ui/browser/button';
import {
  DialogContent,
  DialogContentArea,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@core/primitives/ui/browser/dialog';
import { Input } from '@core/primitives/ui/browser/input';
import { Label } from '@core/primitives/ui/browser/label';

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
    <DialogContent>
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <DialogTitle>Forward Port</DialogTitle>
        </DialogHeader>
        <DialogContentArea>
          <DialogDescription>
            Create a preview tunnel from a remote dev server port.
          </DialogDescription>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[120px_1fr]">
            <Label htmlFor="preview-protocol" className="self-center">
              Protocol
            </Label>
            <select
              id="preview-protocol"
              value={protocol}
              onChange={(event) => setProtocol(event.target.value as PreviewServerProtocol)}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground"
            >
              <option value="http:">HTTP</option>
              <option value="https:">HTTPS</option>
            </select>
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
        </DialogContentArea>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Forwarding...' : 'Forward'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
