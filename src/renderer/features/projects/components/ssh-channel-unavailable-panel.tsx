import { Unplug } from 'lucide-react';

export function SshChannelUnavailablePanel() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-8">
      <div className="flex max-w-sm flex-col items-center text-center gap-3">
        <Unplug className="h-6 w-6 text-foreground-passive" />
        <p className="text-sm font-medium font-mono text-foreground">SSH channel unavailable</p>
        <p className="text-xs text-foreground-passive">
          The remote server refused to open another SSH channel. Project data may be incomplete
          until the connection can open sessions again. Please increase MaxSessions on your remote
          machine.
        </p>
        <p className="text-xs text-foreground-muted">
          This view will update automatically once the SSH server can open channels again.
        </p>
      </div>
    </div>
  );
}
