import { Badge, Button, Tooltip, useToast } from '@emdash/ui/react/primitives';
import { Building2, Circle, CircleCheck, Loader2, Plus, X } from 'lucide-react';
import {
  useIntegrationAccounts,
  useRemoveIntegrationAccount,
  useSetDefaultIntegrationAccount,
} from '@core/features/integrations/api/browser/useIntegrationAccounts';
import { getProjectsWireClient } from '@core/features/projects/api/browser/client';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import type { IntegrationAccountSummary } from '@core/primitives/integrations/api';

function projectLabel(count: number): string {
  return count === 1 ? '1 project' : `${count} projects`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function accountLabel(account: IntegrationAccountSummary): string {
  return account.workspaceLabel || account.displayName || account.accountId;
}

export function IntegrationAccountsSection({
  integrationId,
  integrationName,
}: {
  integrationId: string;
  integrationName: string;
}) {
  const { data: accounts = [], isLoading } = useIntegrationAccounts(integrationId);
  const openSetup = useOpenModal('integrationSetupModal');
  const sorted = [...accounts].sort((a, b) =>
    a.isDefault === b.isDefault
      ? accountLabel(a).localeCompare(accountLabel(b))
      : a.isDefault
        ? -1
        : 1
  );

  const connectAnother = () => void openSetup({ integration: integrationId });

  return (
    <div className="space-y-2">
      {isLoading ? (
        <div className="text-muted-foreground flex items-center gap-2 py-3 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading {integrationName} workspaces...
        </div>
      ) : sorted.length > 0 ? (
        <IntegrationAccountRows integrationId={integrationId} accounts={sorted} />
      ) : null}
      <button
        type="button"
        onClick={connectAnother}
        className="hover:bg-muted/40 flex w-full items-center gap-3 rounded-lg border border-dashed border-border/70 p-3 text-left transition-colors hover:border-border"
      >
        <div className="bg-muted/50 flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
          <Plus className="text-muted-foreground h-4 w-4" />
        </div>
        <span className="text-muted-foreground min-w-0 flex-1 text-sm">
          {sorted.length > 0
            ? `Connect another ${integrationName} workspace`
            : `Connect a ${integrationName} workspace`}
        </span>
      </button>
    </div>
  );
}

function IntegrationAccountRows({
  integrationId,
  accounts,
}: {
  integrationId: string;
  accounts: IntegrationAccountSummary[];
}) {
  const setDefaultMutation = useSetDefaultIntegrationAccount(integrationId);
  const removeMutation = useRemoveIntegrationAccount(integrationId);
  const openConfirmRemove = useOpenModal('confirmActionModal');
  const { toast } = useToast();

  const setDefaultAccount = async (account: IntegrationAccountSummary) => {
    const currentDefault = accounts.find((a) => a.isDefault && a.accountId !== account.accountId);
    if (currentDefault) {
      try {
        const impact = await (
          await getProjectsWireClient()
        ).previewIntegrationAccountRemoval({ integrationId, accountId: currentDefault.accountId });
        if (impact.defaultFollowerCount > 0) {
          const outcome = await openConfirmRemove({
            title: `Make ${accountLabel(account)} the default?`,
            description: `${capitalize(projectLabel(impact.defaultFollowerCount))} follow the current default (${accountLabel(currentDefault)}) and will switch to ${accountLabel(account)}. Pin them individually first if you want them to stay.`,
            confirmLabel: 'Make default',
          });
          if (!outcome.success) return;
        }
      } catch {}
    }

    const result = await setDefaultMutation.mutateAsync(account.accountId);
    if (!result.success) {
      toast.error('Unable to update default workspace', { description: result.error });
      return;
    }
    toast('Default workspace updated', {
      description: `Projects without a pinned workspace will use ${accountLabel(account)}.`,
    });
  };

  const removeAccount = async (account: IntegrationAccountSummary) => {
    const result = await removeMutation.mutateAsync(account.accountId);
    if (!result.success) {
      toast.error('Unable to remove workspace', { description: result.error });
      return;
    }
    toast('Workspace removed', { description: `Removed ${accountLabel(account)}.` });
  };

  const confirmRemove = async (account: IntegrationAccountSummary) => {
    let description = 'This removes the saved credential from Emdash.';
    try {
      const impact = await (
        await getProjectsWireClient()
      ).previewIntegrationAccountRemoval({ integrationId, accountId: account.accountId });
      const parts: string[] = [];
      if (impact.pinnedCount > 0)
        parts.push(`${projectLabel(impact.pinnedCount)} pin this workspace`);
      if (impact.isDefault && impact.defaultFollowerCount > 0) {
        parts.push(`${projectLabel(impact.defaultFollowerCount)} use it as the default`);
      }
      if (parts.length > 0) {
        description = `${capitalize(parts.join(' and '))}. They will need another Linear workspace assigned.`;
      }
    } catch {}

    const outcome = await openConfirmRemove({
      title: `Remove ${accountLabel(account)}?`,
      description,
      confirmLabel: 'Remove',
    });
    if (outcome.success) void removeAccount(account);
  };

  return (
    <Tooltip.Provider delay={150}>
      <div className="space-y-2">
        {accounts.map((account) => (
          <IntegrationAccountRow
            key={account.accountId}
            account={account}
            setDefaultPending={setDefaultMutation.isPending}
            removePending={removeMutation.isPending}
            onSetDefault={() => void setDefaultAccount(account)}
            onRemove={() => void confirmRemove(account)}
          />
        ))}
      </div>
    </Tooltip.Provider>
  );
}

function IntegrationAccountRow({
  account,
  setDefaultPending,
  removePending,
  onSetDefault,
  onRemove,
}: {
  account: IntegrationAccountSummary;
  setDefaultPending: boolean;
  removePending: boolean;
  onSetDefault: () => void;
  onRemove: () => void;
}) {
  const label = accountLabel(account);
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/60 p-3">
      <div className="bg-muted flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/60">
        <Building2 className="text-muted-foreground h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <p className="truncate text-sm font-medium text-foreground">{label}</p>
          {account.isDefault && (
            <Badge variant="soft" className="h-4.5 px-1.5 text-[10px] leading-none">
              Default
            </Badge>
          )}
        </div>
        {account.displayName && account.displayName !== label && (
          <p className="text-muted-foreground truncate text-xs">{account.displayName}</p>
        )}
      </div>
      <Tooltip.Root>
        <Tooltip.Trigger>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon
            disabled={setDefaultPending}
            onClick={account.isDefault ? undefined : onSetDefault}
            aria-label={
              account.isDefault
                ? `${label} is the default workspace`
                : `Set ${label} as the default workspace`
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
          {account.isDefault ? 'Default workspace' : 'Set as default'}
        </Tooltip.Content>
      </Tooltip.Root>
      <Tooltip.Root>
        <Tooltip.Trigger>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon
            disabled={removePending}
            onClick={onRemove}
            aria-label={`Remove ${label}`}
          >
            <X />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side="top">Remove workspace</Tooltip.Content>
      </Tooltip.Root>
    </div>
  );
}
