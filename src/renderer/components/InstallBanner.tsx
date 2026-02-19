import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Copy, Play } from 'lucide-react';
import { Button } from './ui/button';
import { agentMeta, type UiAgent } from '../providers/meta';
import { getDocUrlForProvider, getInstallCommandForProvider } from '@shared/providers/registry';

type Props = {
  agent: UiAgent;
  onOpenExternal: (url: string) => void;
  installCommand?: string | null;
  terminalId?: string;
  onRunInstall?: (command: string) => void;
  mode?: 'missing' | 'start_failed';
  details?: string | null;
};

export const InstallBanner: React.FC<Props> = ({
  agent,
  onOpenExternal,
  installCommand,
  terminalId,
  onRunInstall,
  mode = 'missing',
  details,
}) => {
  const meta = agentMeta[agent];
  const helpUrl = getDocUrlForProvider(agent) ?? null;
  const baseLabel = meta?.label || 'this agent';

  const command =
    installCommand === undefined ? getInstallCommandForProvider(agent) : installCommand;
  const canRunInstall = Boolean(command && (onRunInstall || terminalId));
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<number | null>(null);

  const handleRunInstall = () => {
    if (!command) return;
    if (onRunInstall) {
      onRunInstall(command);
      return;
    }
    if (!terminalId) return;
    try {
      window.electronAPI?.ptyInput?.({ id: terminalId, data: `${command}\n` });
    } catch (error) {
      console.error('Failed to run install command', error);
    }
  };

  const handleCopy = async () => {
    if (!command) return;
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      if (copyResetRef.current) {
        window.clearTimeout(copyResetRef.current);
      }
      copyResetRef.current = window.setTimeout(() => {
        setCopied(false);
        copyResetRef.current = null;
      }, 1800);
    } catch (error) {
      console.error('Failed to copy install command', error);
      setCopied(false);
    }
  };

  useEffect(() => {
    return () => {
      if (copyResetRef.current) {
        window.clearTimeout(copyResetRef.current);
        copyResetRef.current = null;
      }
    };
  }, []);

  const showInstall = mode === 'missing';
  const showDetails = mode === 'start_failed' && Boolean(details?.trim());
  const isPtyDisabledOrUnavailable =
    mode === 'start_failed' &&
    (details?.includes('EMDASH_DISABLE_PTY=1') || details?.toLowerCase().includes('pty unavailable'));

  return (
    <div className="rounded-md border border-border bg-muted p-3 text-sm text-foreground dark:border-border dark:bg-background dark:text-foreground">
      <div className="space-y-2">
        <div className="text-foreground" aria-label={`${baseLabel} status`}>
          <span className="font-normal">
            {helpUrl ? (
              <button
                type="button"
                onClick={() => onOpenExternal(helpUrl)}
                className="inline-flex items-center gap-1 text-foreground hover:text-foreground/80"
              >
                {baseLabel}
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : (
              baseLabel
            )}{' '}
            {mode === 'start_failed' ? 'couldn’t start.' : 'isn’t installed.'}
          </span>{' '}
          {showInstall ? (
            <span className="font-normal text-foreground">Run this in the terminal to use it:</span>
          ) : null}
        </div>

        {showDetails ? (
          <div className="text-foreground">
            <span className="font-medium">Error:</span> {details}
            {isPtyDisabledOrUnavailable ? (
              <div className="mt-1 text-muted-foreground">
                Embedded terminals are disabled/unavailable. Unset `EMDASH_DISABLE_PTY` (or set it
                to `0`) and ensure the PTY native module is installed.
              </div>
            ) : null}
          </div>
        ) : null}

        {showInstall && command ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <code className="inline-flex h-7 items-center rounded bg-muted px-2 font-mono text-xs leading-none">
              {command}
            </code>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleCopy}
              className="text-muted-foreground"
              aria-label="Copy install command"
              title={copied ? 'Copied' : 'Copy command'}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </Button>
            {canRunInstall ? (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleRunInstall}
                className="text-muted-foreground"
                aria-label="Run in terminal"
                title="Run in terminal"
              >
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        ) : showInstall ? (
          <div className="text-foreground">Install the CLI to use it.</div>
        ) : null}
      </div>
    </div>
  );
};

export default InstallBanner;
