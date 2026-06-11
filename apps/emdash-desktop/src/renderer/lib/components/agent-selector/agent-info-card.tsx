import { Check, Copy, ExternalLink } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { Button } from '@renderer/lib/ui/button';
import {
  getDescriptionForProvider,
  getInstallCommandForProvider,
  getProvider,
  type AgentProviderId,
} from '@shared/core/agents/agent-provider-registry';

type Props = {
  id: AgentProviderId;
};

export const AgentInfoCard: React.FC<Props> = ({ id }) => {
  const provider = getProvider(id);
  const description = getDescriptionForProvider(id);
  const installCommand = getInstallCommandForProvider(id) ?? 'npm install -g @openai/codex';
  const title = provider?.name ?? id;
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
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(installCommand);
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
    <div className="w-80 bg-background-quaternary p-3">
      <div className="mb-2 flex items-center justify-between gap-1.5">

        <div className="flex items-center justify-between gap-2 text-sm">
        <AgentIcon id={id} size={16} className="rounded-sm" />
          <span className="text-sm text-foreground">{title}</span>
        </div>
          <Button variant="ghost" size="xs" className="text-foreground-muted p-0" >
            View Website
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
      </div>

      {description ? (
        <p className="mb-2 text-xs leading-relaxed text-foreground-muted">{description}</p>
      ) : null}

      <div className="mb-2 flex h-8 items-center justify-between rounded-md border border-border px-2 text-xs text-foreground">
        <code className="max-w-[calc(100%-2.5rem)] truncate font-mono leading-none">
          {installCommand}
        </code>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => {
            void handleCopyClick();
          }}
          className="ml-2 text-foreground-muted"
          aria-label={`Copy install command for ${title}`}
          title={copied ? 'Copied' : 'Copy command'}
        >
          <CopyIndicatorIcon className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
};
