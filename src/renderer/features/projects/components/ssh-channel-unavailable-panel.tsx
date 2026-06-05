import { Unplug } from 'lucide-react';

export function SshChannelUnavailablePanel() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <Unplug className="h-6 w-6 text-foreground-passive" />
        <p className="font-mono text-sm font-medium text-foreground">SSH channel unavailable</p>
        <p className="text-xs text-foreground-passive">
          The remote server hit its SSH session limit and refused to open another channel. Rundash
          opens several channels per task, so the default{' '}
          <span className="font-mono">MaxSessions</span> of 10 is usually too low.
        </p>
        <div className="w-full rounded-md border border-border bg-background-1 p-3 text-left">
          <p className="mb-2 text-xs text-foreground-passive">
            On the remote machine, edit <span className="font-mono">/etc/ssh/sshd_config</span> and
            raise the limit:
          </p>
          <pre className="overflow-x-auto rounded bg-background px-2 py-1 font-mono text-[11px] text-foreground">
            {'MaxSessions 100     # 500 for heavy parallel use'}
          </pre>
          <p className="mt-2 text-xs text-foreground-passive">Then reload sshd:</p>
          <div className="mt-1 overflow-x-auto rounded bg-background px-2 py-1 font-mono text-[11px] text-foreground">
            <div>sudo systemctl reload sshd</div>
            <div className="text-foreground-muted">// or</div>
            <div>sudo systemctl reload ssh</div>
          </div>
        </div>
        <p className="text-xs text-foreground-muted">
          This view will update automatically once the SSH server can open channels again.
        </p>
      </div>
    </div>
  );
}
