import { Badge, Button, Tooltip, useToast } from '@emdash/ui/react/primitives';
import { Circle, CircleCheck, RefreshCw, X } from 'lucide-react';
import { IntegrationIcon } from '@core/features/integrations/contributions/browser/integration-icon';
import { useIntegrationsContext } from '@core/features/integrations/contributions/browser/integrations-provider';
import { getProjectsWireClient } from '@core/features/projects/api/browser/client';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import type { ProviderAccountSummary } from '@core/primitives/provider-accounts/api';
import { providerCredentialSourceLabel } from '@core/primitives/provider-accounts/browser/account-label';
import type { IntegrationItem } from './IntegrationsCard';

/**
 * Connected-account rows for one provider — GitHub included: every provider's
 * accounts render and mutate through the provider-generic integrations
 * surface backed by the common provider account service. Rows show the
 * account identity (avatar when the provider has
 * one), the default marker, and set-default / remove affordances.
 */
export function IntegrationAccountRows({
  integration,
  accounts,
}: {
  integration: IntegrationItem;
  accounts: ProviderAccountSummary[];
}) {
  const { disconnectIntegration, setDefaultIntegrationAccount, isIntegrationMutating } =
    useIntegrationsContext();
  const openConfirmRemove = useOpenModal('confirmActionModal');
  const openIntegrationSetup = useOpenModal('integrationSetupModal');
  const { toast } = useToast();
  const mutating = isIntegrationMutating(integration.id);

  const accountLabel = (account: ProviderAccountSummary) =>
    account.displayName === account.accountId
      ? (integration.displayName ?? `${integration.name} account`)
      : account.displayName;

  const setDefault = async (account: ProviderAccountSummary) => {
    const result = await setDefaultIntegrationAccount(integration.id, account.accountId);
    if (!result.success) {
      toast.error('Unable to update default account', { description: result.error });
      return;
    }
    toast(`Default ${integration.name} account updated`, {
      description: `Projects without an explicit account use ${accountLabel(account)} now.`,
    });
  };

  const confirmRemove = async (account: ProviderAccountSummary) => {
    let description = `This removes the saved ${integration.name} credentials for this account.`;
    try {
      const count = await (
        await getProjectsWireClient()
      ).countProjectsUsingProviderAccount({
        providerId: integration.id,
        accountId: account.accountId,
      });
      if (count > 0) {
        const projectLabel = count === 1 ? '1 project' : `${count} projects`;
        description = `This account is used by ${projectLabel}. Removing it will disable ${integration.name} features for those projects until another account is assigned.`;
      }
    } catch {}

    const outcome = await openConfirmRemove({
      title: `Remove ${accountLabel(account)}?`,
      description,
      confirmLabel: 'Remove',
    });
    if (!outcome.success) return;
    const result = await disconnectIntegration(integration.id, account.accountId);
    if (!result.success) {
      toast.error('Unable to remove account', { description: result.error });
      return;
    }
    toast(`${integration.name} account removed`, {
      description: `Removed ${accountLabel(account)}.`,
    });
  };

  return (
    <Tooltip.Provider delay={150}>
      <div className="space-y-2">
        {accounts.map((account) => (
          <div
            key={account.accountId}
            className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/60 p-3"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center">
              {account.avatarUrl ? (
                <img
                  src={account.avatarUrl}
                  alt={accountLabel(account)}
                  className="h-9 w-9 rounded-full border border-border/60"
                />
              ) : (
                <IntegrationIcon provider={integration.id} size={22} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <p className="truncate text-sm font-medium text-foreground">
                  {accountLabel(account)}
                </p>
                {account.isDefault && accounts.length > 1 ? (
                  <Tooltip.Root>
                    <Tooltip.Trigger className="inline-flex h-4.5 items-center leading-none">
                      <Badge>Default</Badge>
                    </Tooltip.Trigger>
                    <Tooltip.Content side="top">
                      Projects without an explicit account use this one.
                    </Tooltip.Content>
                  </Tooltip.Root>
                ) : null}
                {account.credentialSource ? (
                  <Badge variant="outline">
                    {providerCredentialSourceLabel(account.credentialSource)}
                  </Badge>
                ) : null}
              </div>
              <p className="text-muted-foreground truncate text-xs">
                {account.displayDetail ?? 'Connected'}
              </p>
            </div>
            {accounts.length > 1 ? (
              <Tooltip.Root>
                <Tooltip.Trigger>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon
                    disabled={mutating}
                    onClick={account.isDefault ? undefined : () => void setDefault(account)}
                    aria-label={
                      account.isDefault
                        ? `${accountLabel(account)} is the default ${integration.name} account`
                        : `Set ${accountLabel(account)} as default ${integration.name} account`
                    }
                  >
                    {account.isDefault ? (
                      <CircleCheck className="text-foreground" />
                    ) : (
                      <Circle className="text-foreground-muted" />
                    )}
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content side="top">
                  {account.isDefault ? 'Default account' : 'Set as default'}
                </Tooltip.Content>
              </Tooltip.Root>
            ) : null}
            {integration.canReconnect ? (
              <Tooltip.Root>
                <Tooltip.Trigger>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon
                    disabled={mutating}
                    onClick={() => {
                      void openIntegrationSetup({
                        integration: integration.id,
                        accountId: account.accountId,
                        displayName:
                          account.displayName !== account.accountId
                            ? account.displayName
                            : undefined,
                      });
                    }}
                    aria-label={`Reconnect ${accountLabel(account)}`}
                  >
                    <RefreshCw />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content side="top">Reconnect account</Tooltip.Content>
              </Tooltip.Root>
            ) : null}
            <Tooltip.Root>
              <Tooltip.Trigger>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon
                  disabled={mutating}
                  onClick={() => void confirmRemove(account)}
                  aria-label={`Remove ${accountLabel(account)}`}
                >
                  <X />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content side="top">Remove account</Tooltip.Content>
            </Tooltip.Root>
          </div>
        ))}
      </div>
    </Tooltip.Provider>
  );
}
