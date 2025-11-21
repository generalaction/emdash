import React from 'react';
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
  goose: 'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash',
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
};

export const TerminalModeBanner: React.FC<Props> = ({ provider, onOpenExternal, installCommand }) => {
  const meta = providerMeta[provider];
  const helpUrl = meta?.helpUrl;
  const baseLabel = meta?.label || 'this provider';

  const command = installCommand || getInstallCommandForProvider(provider);

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
      <div className="whitespace-pre-wrap">
        <div className="text-foreground" aria-label={`${baseLabel} status`}>
          {helpUrl ? (
            <button
              type="button"
              onClick={() => onOpenExternal(helpUrl)}
              className="underline underline-offset-2 hover:text-foreground/80"
            >
              {baseLabel}
            </button>
          ) : (
            baseLabel
          )}{' '}
          isn’t installed.{' '}
          {command ? (
            <>
              Run <code className="mx-1 rounded bg-gray-200 px-1 py-0.5 text-xs">{command}</code> to
              use it.
            </>
          ) : (
            'Install the CLI to use it.'
          )}
        </div>
      </div>
    </div>
  );
};

export default TerminalModeBanner;
