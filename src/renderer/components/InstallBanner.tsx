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
};

export const InstallBanner: React.FC<Props> = ({
  agent,
  onOpenExternal,
  installCommand,
  terminalId,
  onRunInstall,
}) => {
  const meta = agentMeta[agent];
  const helpUrl = getDocUrlForProvider(agent) ?? null;
  const baseLabel = meta?.label || 'this agent';

  const command = installCommand || getInstallCommandForProvider(agent);
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
            isn’t installed.
          </span>{' '}
          <span className="font-normal text-foreground">Run this in the terminal to use it:</span>
        </div>

        {command ? (
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
        ) : (
          <div className="text-foreground">Install the CLI to use it.</div>
        )}
      </div>
    </div>
  );
};

export default InstallBanner;
