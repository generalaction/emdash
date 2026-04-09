import { ArrowUpRight, Check, Copy } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import {
  getDescriptionForProvider,
  getDocUrlForProvider,
  getInstallCommandForProvider,
  getProvider,
} from '@shared/agent-provider-registry';
import { agentConfig } from '@renderer/lib/agentConfig';
import { type UiAgent } from '@renderer/providers/meta';
import AgentLogo from './agent-logo';
import { Button } from './ui/button';

type Props = {
  id: UiAgent;
};

export const AgentInfoCard: React.FC<Props> = ({ id }) => {
  const provider = getProvider(id);
  const config = agentConfig[id];
  const description = getDescriptionForProvider(id);
  const installCommand = getInstallCommandForProvider(id) ?? 'npm install -g @openai/codex';
  const docUrl = getDocUrlForProvider(id);
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
    <div className="w-80 max-w-[20rem] rounded-lg border border-border bg-background p-3 text-foreground shadow-md">
      <div className="mb-2 flex items-center gap-2">
        <AgentLogo
          logo={config.logo}
          alt={config.alt}
          isSvg={config.isSvg}
          invertInDark={config.invertInDark}
          className="h-5 w-5 rounded-sm"
        />
        <div className="flex items-baseline gap-1 text-sm leading-none">
          <span className="text-foreground-muted">{config.name}</span>
          <span className="text-foreground-muted">/</span>
          <strong className="font-medium text-foreground">{title}</strong>
        </div>
      </div>

      {description ? (
        <p className="mb-2 text-xs leading-relaxed text-foreground-muted">{description}</p>
      ) : null}

      {docUrl ? (
        <div className="mb-2">
          <a
            href={docUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-background-1"
          >
            <span>Docs</span>
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      ) : null}

      <div className="mb-2">
        <a
          href="https://artificialanalysis.ai/insights/coding-agents-comparison"
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-background-1"
        >
          <span>Compare agents</span>
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </div>

      <div className="mb-2 flex h-8 items-center justify-between rounded-md border border-border px-2 text-xs text-foreground">
        <code className="max-w-[calc(100%-2.5rem)] truncate font-mono leading-none">
          {installCommand}
        </code>
        <Button
          variant="ghost"
          size="icon-sm"
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

export default AgentInfoCard;
