import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Copy, Play } from 'lucide-react';
import { providerMeta, type UiProvider } from '../providers/meta';

const INSTALL_COMMANDS: Partial<Record<UiProvider, string>> = {
  codex: 'npm install -g @openai/codex',
  claude: 'npm install -g @anthropic-ai/claude-code',
  qwen: 'npm install -g @qwen-code/qwen-code',
  droid: 'curl -fsSL https://app.factory.ai/cli | sh',
  gemini: 'npm install -g @google/gemini-cli',
  cursor: 'curl https://cursor.com/install -fsS | bash',
  copilot: 'npm install -g @github/copilot',
  amp: 'npm install -g @sourcegraph/amp@latest',
  opencode: 'npm install -g opencode-ai',
  charm: 'npm install -g @charmland/crush',
  auggie: 'npm install -g @augmentcode/auggie',
  goose:
    'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash',
  kimi: 'uv tool install --python 3.13 kimi-cli',
  kiro: 'curl -fsSL https://cli.kiro.dev/install | bash',
  rovo: 'acli rovodev auth login',
};

export const getInstallCommandForProvider = (provider: UiProvider): string | null =>
  INSTALL_COMMANDS[provider] ?? null;

type Props = {
  provider: UiProvider;
  onOpenExternal: (url: string) => void;
  installCommand?: string | null;
  terminalId?: string;
  onRunInstall?: (command: string) => void;
};

export const InstallBanner: React.FC<Props> = ({
  provider,
  onOpenExternal,
  installCommand,
  terminalId,
  onRunInstall,
}) => {
  const meta = providerMeta[provider];
  const helpUrl = meta?.helpUrl;
  const baseLabel = meta?.label || 'this provider';

  const command = installCommand || getInstallCommandForProvider(provider);
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
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
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
            <code className="inline-flex h-7 items-center rounded bg-gray-200 px-2 font-mono text-xs leading-none">
              {command}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition hover:text-foreground"
              aria-label="Copy install command"
              title={copied ? 'Copied' : 'Copy command'}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
            {canRunInstall ? (
              <button
                type="button"
                onClick={handleRunInstall}
                className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition hover:text-foreground"
                aria-label="Run in terminal"
                title="Run in terminal"
              >
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
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
