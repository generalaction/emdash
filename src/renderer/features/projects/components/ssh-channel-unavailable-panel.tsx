import { Unplug } from 'lucide-react';

export function SshChannelUnavailablePanel() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-center text-center gap-3">
        <Unplug className="h-6 w-6 text-foreground-passive" />
        <p className="text-sm font-medium font-mono text-foreground">SSH channel unavailable</p>
        <p className="text-xs text-foreground-passive">
          The remote server hit its SSH session limit and refused to open another channel. emdash
          opens several channels per task, so the default{' '}
          <span className="font-mono">MaxSessions</span> of 10 is usually too low.
        </p>
        <div className="w-full rounded-md border border-border bg-background-1 p-3 text-left">
          <p className="text-xs text-foreground-passive mb-2">
            On the remote machine, edit <span className="font-mono">/etc/ssh/sshd_config</span> and
            raise the limit:
          </p>
          <pre className="text-[11px] font-mono text-foreground bg-background rounded px-2 py-1 overflow-x-auto">
            MaxSessions 100{'     '}
            <span className="text-foreground-muted">// 500 for heavy parallel use</span>
          </pre>
          <p className="text-xs text-foreground-passive mt-2">Then reload sshd:</p>
          <div className="text-[11px] font-mono text-foreground bg-background rounded px-2 py-1 mt-1 overflow-x-auto">
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
