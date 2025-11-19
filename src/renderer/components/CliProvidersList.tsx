import React, { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import IntegrationRow from './IntegrationRow';
import { CliProviderStatus } from '../types/connections';
import codexLogo from '../../assets/images/openai.png';
import claudeLogo from '../../assets/images/claude.png';
import droidLogo from '../../assets/images/factorydroid.png';
import geminiLogo from '../../assets/images/gemini.png';
import cursorLogo from '../../assets/images/cursorlogo.png';
import copilotLogo from '../../assets/images/ghcopilot.png';
import ampLogo from '../../assets/images/ampcode.png';
import opencodeLogo from '../../assets/images/opencode.png';
import charmLogo from '../../assets/images/charm.png';
import augmentLogo from '../../assets/images/augmentcode.png';
import qwenLogo from '../../assets/images/qwen.png';
import kimiLogo from '../../assets/images/kimi.png';
import kiroLogo from '../../assets/images/kiro.png';
import atlassianLogo from '../../assets/images/atlassian.png';

interface CliProvidersListProps {
  providers: CliProviderStatus[];
  isLoading: boolean;
  error?: string | null;
}

export const BASE_CLI_PROVIDERS: CliProviderStatus[] = [
  { id: 'codex', name: 'Codex', status: 'missing', docUrl: 'https://github.com/openai/codex' },
  {
    id: 'claude',
    name: 'Claude Code',
    status: 'missing',
    docUrl: 'https://docs.anthropic.com/claude/docs/claude-code',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    status: 'missing',
    docUrl: 'https://cursor.sh',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    status: 'missing',
    docUrl: 'https://github.com/google-gemini/gemini-cli',
  },
  {
    id: 'droid',
    name: 'Droid',
    status: 'missing',
    docUrl: 'https://docs.factory.ai/cli/getting-started/quickstart',
  },
  {
    id: 'amp',
    name: 'Amp',
    status: 'missing',
    docUrl: 'https://ampcode.com/manual#install',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    status: 'missing',
    docUrl: 'https://opencode.ai/docs/cli/',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    status: 'missing',
    docUrl: 'https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli',
  },
  {
    id: 'charm',
    name: 'Charm',
    status: 'missing',
    docUrl: 'https://github.com/charmbracelet/crush',
  },
  {
    id: 'auggie',
    name: 'Auggie',
    status: 'missing',
    docUrl: 'https://docs.augmentcode.com/cli/overview',
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    status: 'missing',
    docUrl: 'https://github.com/QwenLM/qwen-code',
  },
  {
    id: 'kimi',
    name: 'Kimi',
    status: 'missing',
    docUrl: 'https://www.kimi.com/coding/docs/en/kimi-cli.html',
  },
  {
    id: 'kiro',
    name: 'Kiro',
    status: 'missing',
    docUrl: 'https://kiro.dev/docs/cli/',
  },
  {
    id: 'rovo',
    name: 'Rovo Dev (Atlassian)',
    status: 'missing',
    docUrl: 'https://support.atlassian.com/rovo/docs/install-and-run-rovo-dev-cli-on-your-device/',
  },
];

const PROVIDER_LOGOS: Record<string, string> = {
  codex: codexLogo,
  claude: claudeLogo,
  droid: droidLogo,
  gemini: geminiLogo,
  cursor: cursorLogo,
  copilot: copilotLogo,
  amp: ampLogo,
  opencode: opencodeLogo,
  charm: charmLogo,
  auggie: augmentLogo,
  qwen: qwenLogo,
  kimi: kimiLogo,
  kiro: kiroLogo,
  rovo: atlassianLogo,
};

const renderProviderRow = (provider: CliProviderStatus) => {
  const logo = PROVIDER_LOGOS[provider.id];

  const handleNameClick =
    provider.docUrl && window?.electronAPI?.openExternal
      ? async () => {
          try {
            await window.electronAPI.openExternal(provider.docUrl!);
          } catch (openError) {
            console.error(`Failed to open ${provider.name} docs:`, openError);
          }
        }
      : undefined;

  const isDetected = provider.status === 'connected';
  const indicatorClass = isDetected ? 'bg-emerald-500' : 'bg-muted-foreground/50';
  const statusLabel = isDetected ? 'Detected' : 'Not detected';

  return (
    <IntegrationRow
      key={provider.id}
      logoSrc={logo}
      icon={
        logo ? undefined : (
          <Sparkles className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        )
      }
      name={provider.name}
      onNameClick={handleNameClick}
      status={provider.status}
      statusLabel={statusLabel}
      showStatusPill={false}
      middle={
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className={`h-1.5 w-1.5 rounded-full ${indicatorClass}`} />
          {statusLabel}
        </span>
      }
    />
  );
};

const CliProvidersList: React.FC<CliProvidersListProps> = ({ providers, isLoading, error }) => {
  const sortedProviders = useMemo(() => {
    const source = providers.length ? providers : BASE_CLI_PROVIDERS;
    return [...source].sort((a, b) => {
      if (a.status === 'connected' && b.status !== 'connected') return -1;
      if (b.status === 'connected' && a.status !== 'connected') return 1;
      return a.name.localeCompare(b.name);
    });
  }, [providers]);

  return (
    <div className="space-y-3">
      {error ? (
        <div className="rounded-md border border-red-200/70 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:border-red-500/40 dark:text-red-400">
          {error}
        </div>
      ) : null}

      <div className="space-y-2">
        {sortedProviders.map((provider) => renderProviderRow(provider))}
      </div>
    </div>
  );
};

export default CliProvidersList;
