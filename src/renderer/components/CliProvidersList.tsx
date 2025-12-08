import React, { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import IntegrationRow from './IntegrationRow';
import { CliProviderStatus } from '../types/connections';
import { PROVIDERS } from '@shared/providers/registry';
import { providerAssets } from '@/providers/assets';

interface CliProvidersListProps {
  providers: CliProviderStatus[];
  isLoading: boolean;
  error?: string | null;
}

export const BASE_CLI_PROVIDERS: CliProviderStatus[] = PROVIDERS.filter(
  (provider) => provider.detectable !== false
).map((provider) => ({
  id: provider.id,
  name: provider.name,
  status: 'missing' as const,
  docUrl: provider.docUrl ?? null,
  installCommand: provider.installCommand ?? null,
}));

const renderProviderRow = (provider: CliProviderStatus) => {
  const logo = providerAssets[provider.id as keyof typeof providerAssets]?.logo;

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
      installCommand={provider.installCommand}
      middle={
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className={`h-1.5 w-1.5 rounded-full ${indicatorClass}`} />
          {statusLabel}
        </span>
      }
    />
  );
};

const CliProvidersList: React.FC<CliProvidersListProps> = ({ providers, error }) => {
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
