import { Button, MicroLabel } from '@emdash/ui/react/primitives';
import { Loader2, Plus, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { ISSUE_FEATURE_LABELS } from '@core/features/integrations/api/browser/integration-display';
import { IntegrationIcon } from '@core/features/integrations/contributions/browser/integration-icon';
import { useIntegrationsContext } from '@core/features/integrations/contributions/browser/integrations-provider';
import { IntegrationAccountRows } from './IntegrationAccountsSection';
import type { IntegrationItem } from './IntegrationsCard';

export function IntegrationDetailSidebar({
  integration,
  onClose,
}: {
  integration: IntegrationItem;
  onClose: () => void;
}) {
  const { integrationAccounts, isLoadingAccounts, accountsError } = useIntegrationsContext();
  const accounts = integrationAccounts[integration.id] ?? [];
  const accountLabel = accounts.length > 1 ? 'Accounts' : 'Account';

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
                <IntegrationIcon provider={integration.id} icon={integration.icon} size={36} />
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
              <div className="space-y-2">
                {isLoadingAccounts ? (
                  <p className="text-sm text-foreground-muted">Loading accounts…</p>
                ) : null}
                {accountsError ? (
                  <p role="alert" className="text-sm text-foreground-error">
                    Unable to load accounts. {accountsError.message}
                  </p>
                ) : null}
                {accounts.length > 0 && (
                  <IntegrationAccountRows integration={integration} accounts={accounts} />
                )}
                {!isLoadingAccounts && !accountsError ? (
                  <AddAccountCard
                    integration={integration}
                    label={
                      accounts.length > 0 ? `Add another ${integration.name} account` : undefined
                    }
                  />
                ) : null}
              </div>
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
