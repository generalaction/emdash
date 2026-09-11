import { Button, Tooltip } from '@emdash/ui/react/primitives';
import { card } from '@emdash/ui/styles/recipes/card';
import { CheckCircle2, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { SshConfigHost } from '@core/primitives/ssh/api';

export function MachineConnectionDetails({
  host,
  target,
}: {
  host: SshConfigHost;
  target: string;
}) {
  return (
    <div className={card({ padding: 'md', radius: 'lg' })}>
      <dl className="grid gap-2 text-sm">
        <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3">
          <dt className="text-foreground-muted">Host</dt>
          <dd className="break-all">{host?.hostname || target}</dd>
        </div>
        <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3">
          <dt className="text-foreground-muted">Port</dt>
          <dd>{host?.port ?? 22}</dd>
        </div>
        <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3">
          <dt className="text-foreground-muted">Username</dt>
          <dd className="break-all">{host?.user || 'Not specified'}</dd>
        </div>
        <CopyableConnectionDetail
          key={`jump-${host?.proxyJump}`}
          label="Jump host"
          value={host?.proxyJump}
        />
        {host?.proxyCommand && (
          <CopyableConnectionDetail
            key={host.proxyCommand}
            label="Proxy command"
            value={host.proxyCommand}
            copyOnValueClick
          />
        )}
        <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3">
          <dt className="text-foreground-muted">Forward SSH agent</dt>
          <dd>{host?.forwardAgent ? 'On' : 'Off'}</dd>
        </div>
      </dl>
    </div>
  );
}

function CopyableConnectionDetail({
  label,
  value,
  copyOnValueClick = false,
}: {
  label: string;
  value?: string;
  copyOnValueClick?: boolean;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const copyValue = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  };
  useEffect(() => {
    if (copyState !== 'copied') return;
    const timeout = setTimeout(() => setCopyState('idle'), 2000);
    return () => clearTimeout(timeout);
  }, [copyState]);
  return (
    <div className="group grid min-w-0 grid-cols-[9rem_minmax(0,1fr)] items-center gap-3">
      <dt className="text-foreground-muted">{label}</dt>
      <dd className="min-w-0">
        {value ? (
          <div className="flex min-w-0 items-center gap-1">
            {copyOnValueClick ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="group/copy relative min-w-0 flex-1 justify-start px-0 text-sm font-normal"
                style={{ cursor: 'pointer', userSelect: 'none' }}
                aria-label={`Copy ${label.toLowerCase()}`}
                onClick={copyValue}
              >
                <span
                  className="pointer-events-none block truncate transition-opacity group-hover/copy:opacity-30 group-focus-visible/copy:opacity-30"
                  style={{ userSelect: 'none' }}
                >
                  {value}
                </span>
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity group-hover/copy:opacity-100 group-focus-visible/copy:opacity-100 [@media(hover:none)]:opacity-100 ${copyState === 'copied' ? 'opacity-100' : 'opacity-0'}`}
                >
                  <span className="bg-surface rounded p-1">
                    {copyState === 'copied' ? (
                      <CheckCircle2 className="size-3" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                  </span>
                </span>
              </Button>
            ) : (
              <Tooltip.Root>
                <Tooltip.Trigger render={<span tabIndex={0} className="min-w-0 flex-1 truncate" />}>
                  {value}
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <span className="break-all">{value}</span>
                </Tooltip.Content>
              </Tooltip.Root>
            )}
            {!copyOnValueClick && (
              <Tooltip.Root>
                <Tooltip.Trigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      icon
                      className="shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                      aria-label={`Copy ${label.toLowerCase()}`}
                      onClick={copyValue}
                    />
                  }
                >
                  {copyState === 'copied' ? (
                    <CheckCircle2 className="size-3" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                </Tooltip.Trigger>
                <Tooltip.Content>
                  {copyState === 'copied' ? 'Copied' : `Copy ${label.toLowerCase()}`}
                </Tooltip.Content>
              </Tooltip.Root>
            )}
          </div>
        ) : (
          'None'
        )}
        <div
          role="status"
          className={copyState === 'error' ? 'text-xs text-foreground-muted' : 'sr-only'}
        >
          {copyState === 'error'
            ? 'Could not copy. Try again.'
            : copyState === 'copied'
              ? `${label} copied to clipboard.`
              : null}
        </div>
      </dd>
    </div>
  );
}
