import { Loader2, Plus, Trash2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { ISSUE_FEATURE_LABELS } from '@renderer/features/integrations/issue-provider-meta';
import { PROVIDER_ICON_COMPONENTS } from '@renderer/features/integrations/provider-icons';
import { Button } from '@renderer/lib/ui/button';
import { MicroLabel } from '@renderer/lib/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import type { GitHubAccountSummary } from '@shared/github';
import type { IssueProviderType } from '@shared/issue-providers';
import { GitHubAccountRows } from './GitHubAccountsSection';
import type { IntegrationItem } from './IntegrationsCard';

export function IntegrationDetailSidebar({
  integration,
  githubAccounts,
  onClose,
}: {
  integration: IntegrationItem;
  githubAccounts: GitHubAccountSummary[];
  onClose: () => void;
}) {
  const Icon = PROVIDER_ICON_COMPONENTS[integration.id];
  const accountLabel = integration.id === 'github' ? 'Accounts' : 'Account';

  return (
    <div className="relative flex h-full flex-col">
      <Button
        variant="ghost"
        size="sm"
        onClick={onClose}
        className="absolute top-4 right-4 p-0"
        aria-label="Close"
      >
        <X className="size-4" />
      </Button>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-4">
        <div className="space-y-3">
          <div>
            <MicroLabel>Integration</MicroLabel>
            <div className="mt-3 flex items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center">
                <Icon size={36} />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h2 className="text-sm font-medium text-foreground">{integration.name}</h2>
                  <div className="flex flex-wrap items-center gap-1">
                    {integration.features.map((feature) => (
                      <CapabilityBadge key={feature}>
                        {ISSUE_FEATURE_LABELS[feature] ?? feature}
                      </CapabilityBadge>
                    ))}
                  </div>
                </div>
                <p className="text-sm leading-5 text-foreground-muted">{integration.description}</p>
              </div>
            </div>
          </div>

          <div>
            <MicroLabel>{accountLabel}</MicroLabel>
            <div className="mt-3">
              {integration.id === 'github' ? (
                <div className="space-y-2">
                  {githubAccounts.length > 0 && <GitHubAccountRows accounts={githubAccounts} />}
                  <AddAccountCard
                    integration={integration}
                    label="Add GitHub account"
                    detail={
                      githubAccounts.length === 0
                        ? 'No GitHub accounts are connected.'
                        : 'Connect a GitHub or GitHub Enterprise account.'
                    }
                  />
                </div>
              ) : integration.isConfigured ? (
                <SingleIntegrationAccount integration={integration} />
              ) : (
                <AddAccountCard integration={integration} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CapabilityBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 items-center rounded bg-background-2 px-1.5 text-xs font-medium text-foreground-muted">
      {children}
    </span>
  );
}

function SingleIntegrationAccount({ integration }: { integration: IntegrationItem }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/60 p-3">
      <AccountIcon provider={integration.id} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {integration.displayName ?? `${integration.name} account`}
        </p>
        <p className="truncate text-xs text-foreground-muted">
          {integration.displayDetail ?? 'Connected'}
        </p>
      </div>
      {integration.onDisconnect && (
        <Tooltip>
          <TooltipTrigger>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={integration.onDisconnect}
              aria-label={`Disconnect ${integration.name}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Disconnect</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function AddAccountCard({
  integration,
  label,
  detail,
}: {
  integration: IntegrationItem;
  label?: string;
  detail?: string;
}) {
  return (
    <button
      type="button"
      onClick={integration.onConnect}
      disabled={integration.isMutating}
      className="focus-visible:ring-ring flex w-full items-center gap-3 rounded-lg border border-dashed border-border/70 p-3 text-left transition-colors hover:border-border hover:bg-background-1 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      aria-label={`Add ${integration.name} account`}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center">
        {integration.isMutating ? (
          <Loader2 className="h-4 w-4 animate-spin text-foreground-muted" />
        ) : (
          <Plus className="h-4 w-4 text-foreground-muted" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {label ?? `Add ${integration.name} account`}
        </p>
        <p className="truncate text-xs text-foreground-muted">
          {detail ?? `Connect ${integration.name} to start using this integration.`}
        </p>
      </div>
    </button>
  );
}

function AccountIcon({ provider }: { provider: IssueProviderType }) {
  const Icon = PROVIDER_ICON_COMPONENTS[provider];

  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center">
      <Icon size={22} />
    </div>
  );
}
