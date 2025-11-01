import React, { useEffect, useRef, useState } from 'react';
import { Workflow, ArrowUpRight, Check, Copy } from 'lucide-react';

export const RoutingInfoCard: React.FC = () => {
  const installCommand = 'npm install -g @openai/codex';
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetRef.current !== null) {
        window.clearTimeout(copyResetRef.current);
      }
    };
  }, []);

  const handleCopyClick = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }
    const { clipboard } = navigator;
    if (typeof clipboard.writeText !== 'function') {
      return;
    }
    try {
      await clipboard.writeText(installCommand);
      setCopied(true);
      if (copyResetRef.current !== null) {
        window.clearTimeout(copyResetRef.current);
      }
      copyResetRef.current = window.setTimeout(() => {
        setCopied(false);
        copyResetRef.current = null;
      }, 2000);
    } catch (error) {
      console.error('Failed to copy install command', error);
      setCopied(false);
    }
  };

  const CopyIndicatorIcon = copied ? Check : Copy;

  return (
    <div className="w-80 max-w-[20rem] rounded-lg bg-background p-3 text-foreground shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <Workflow className="h-5 w-5" aria-hidden="true" />
        <div className="flex items-baseline gap-1 text-sm leading-none">
          <span className="text-muted-foreground">Agent</span>
          <span className="text-muted-foreground">/</span>
          <strong className="font-semibold text-foreground">Routing</strong>
        </div>
        <span className="ml-auto rounded-md border px-1.5 py-0.5 text-[10px] text-muted-foreground">
          Soon
        </span>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        Smart routing between available CLIs to pick the best tool for your request.
      </p>
      <div className="mb-2">
        <a
          href="https://artificialanalysis.ai/insights/coding-agents-comparison"
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-foreground hover:underline"
        >
          <span>Compare agents</span>
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </div>
      <div className="flex h-7 items-center justify-between rounded-md border px-2 text-xs text-foreground">
        <code className="max-w-[calc(100%-2.5rem)] truncate font-mono text-[11px] leading-none">
          {installCommand}
        </code>
        <button
          type="button"
          onClick={() => {
            void handleCopyClick();
          }}
          className="ml-2 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          aria-label="Copy install command"
          title={copied ? 'Copied' : 'Copy command'}
        >
          <CopyIndicatorIcon className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

export default RoutingInfoCard;
