import { Field, Select, Separator } from '@emdash/ui/react/primitives';
import { Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import { useAccounts } from '@core/features/integrations/api/browser/use-provider-accounts';
import { IntegrationIcon } from '@core/features/integrations/contributions/browser/integration-icon';
import { useIntegrationsContext } from '@core/features/integrations/contributions/browser/integrations-provider';
import {
  ProvenanceBadge,
  ResetProvenanceButton,
} from '@core/features/projects/contributions/browser/settings-provenance';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import {
  resolveProviderAccount,
  type Resolved,
  type StoredIntegrationAccount,
} from '@core/primitives/project-settings/api';
import { providerAccountHostMatching } from '@core/primitives/project-settings/api/resolve-provider-account';
import {
  sortProviderAccountsByDefault,
  type ProviderAccountSummary,
} from '@core/primitives/provider-accounts/api';
import { ProviderAccountLabel } from '@core/primitives/provider-accounts/browser/account-label';
import { cn } from '@core/primitives/styling/browser/cn';
import type { FormUpdate, IntegrationAccountsFormState } from '../project-settings-form-model';

/** File-local Select option encodings; never stored or exported. */
const NO_ACCOUNT_OPTION = '__no_provider_account__';
const CONNECT_OPTION = '__connect_provider_account__';

/** One account-selection row per integration, using the same host policy as issue execution. */
export const IntegrationAccountsSection = observer(function IntegrationAccountsSection({
  integrationAccountsForm,
  updateIntegrationAccounts,
  repositoryHost,
}: {
  integrationAccountsForm: IntegrationAccountsFormState;
  updateIntegrationAccounts: FormUpdate<IntegrationAccountsFormState>;
  /** Effective base-remote host; undefined while repository facts are loading. */
  repositoryHost: string | null | undefined;
}) {
  const { integrations } = useIntegrationsContext();
  const accountsQuery = useAccounts();
  const integrationAccounts = accountsQuery.data;
  const openIntegrationSetup = useOpenModal('integrationSetupModal');

  const integrationRows = integrations
    .map((integration) => {
      const accounts = sortProviderAccountsByDefault(integrationAccounts?.[integration.id] ?? []);
      const override = integrationAccountsForm[integration.id] ?? undefined;
      const repositoryScoped = integration.issueCapabilities.requiresRepositoryUrl;
      const ready = integrationAccounts && (!repositoryScoped || repositoryHost !== undefined);
      return {
        integration,
        accounts,
        override,
        resolution: ready
          ? resolveProviderAccount(
              override,
              accounts,
              repositoryScoped ? providerAccountHostMatching(repositoryHost ?? null) : undefined
            )
          : null,
      };
    })
    .filter(({ accounts, override }) => accounts.length > 0 || override !== undefined);

  if (integrationRows.length === 0) return null;

  return (
    <>
      <Field.Root>
        <Field.Label>Accounts</Field.Label>
        <Field.Description className="text-foreground-muted">
          Choose which account each integration uses for this project.
        </Field.Description>
        <div className="flex flex-col">
          {integrationRows.map(({ integration, accounts, override, resolution }) => (
            <ProviderAccountRow
              key={integration.id}
              name={integration.name}
              accounts={accounts}
              resolution={resolution}
              override={override}
              fallbackIcon={<IntegrationIcon provider={integration.id} icon={integration.icon} />}
              loadError={accountsQuery.isError}
              onOverrideChange={(value) => updateIntegrationAccounts(integration.id, value)}
              onConnect={() => void openIntegrationSetup({ integration: integration.id })}
              unresolvableHint={
                integration.issueCapabilities.requiresRepositoryUrl
                  ? `The ${integration.name} account set for this project is no longer connected or does not match this repository's host. ${integration.name} stays paused until you pick an account or reset.`
                  : undefined
              }
            />
          ))}
        </div>
      </Field.Root>
      <Separator />
    </>
  );
});

const ProviderAccountRow = observer(function ProviderAccountRow({
  name,
  accounts,
  resolution,
  override,
  onOverrideChange,
  onConnect,
  unresolvableHint,
  loadError,
  fallbackIcon,
}: {
  name: string;
  accounts: ProviderAccountSummary[];
  /** Effective account over the pending form state. */
  resolution: Resolved<ProviderAccountSummary | null> | null;
  loadError?: boolean;
  fallbackIcon?: ReactNode;
  override: StoredIntegrationAccount | undefined;
  onOverrideChange: (value: StoredIntegrationAccount | null) => void;
  onConnect: () => void;
  unresolvableHint?: string;
}) {
  const unresolvable = resolution?.provenance.kind === 'unresolvable';
  const isExplicit = override !== undefined;

  const selectValue = unresolvable
    ? ''
    : override === undefined
      ? ''
      : override.kind === 'none'
        ? NO_ACCOUNT_OPTION
        : override.accountId;

  return (
    <div className="flex flex-col">
      <div className="flex min-h-9 items-center justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium text-foreground">{name}</span>
          {resolution ? <ProvenanceBadge provenance={resolution.provenance} /> : null}
          {resolution && isExplicit ? (
            <ResetProvenanceButton onReset={() => onOverrideChange(null)} />
          ) : null}
        </div>
        <Select.Root
          value={selectValue}
          disabled={resolution === null}
          onValueChange={(value) => {
            if (!value) return;
            if (value === CONNECT_OPTION) {
              onConnect();
              return;
            }
            onOverrideChange(
              value === NO_ACCOUNT_OPTION ? { kind: 'none' } : { kind: 'account', accountId: value }
            );
          }}
        >
          <Select.Trigger
            className={cn('min-w-0 shrink-0 text-left', unresolvable && 'text-foreground-warning')}
            style={{ width: '18rem', maxWidth: '65%' }}
          >
            {resolution?.value ? (
              <ProviderAccountLabel account={resolution.value} fallbackIcon={fallbackIcon} />
            ) : (
              <span className="min-w-0 flex-1 truncate text-left">
                {resolution === null
                  ? loadError
                    ? 'Unable to load accounts'
                    : 'Loading accounts…'
                  : unresolvable
                    ? `Unavailable ${name} account`
                    : `No ${name} account`}
              </span>
            )}
          </Select.Trigger>
          <Select.Content width="trigger" align="end" alignItemWithTrigger={false} sideOffset={6}>
            <>
              {accounts.map((account) => (
                <Select.Item key={account.accountId} value={account.accountId} className="py-2">
                  <ProviderAccountLabel
                    account={account}
                    fallbackIcon={fallbackIcon}
                    showDefaultBadge
                  />
                </Select.Item>
              ))}
              <Select.Item value={NO_ACCOUNT_OPTION} className="py-2">
                <span className="relative -top-px shrink-0">No {name} account</span>
              </Select.Item>
              <Select.Separator />
              <Select.Item value={CONNECT_OPTION} className="py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Plus className="text-muted-foreground h-4 w-4 shrink-0" />
                  <span className="relative -top-px shrink-0">Connect another account…</span>
                </div>
              </Select.Item>
            </>
          </Select.Content>
        </Select.Root>
      </div>
      {unresolvable ? (
        <span className="pb-2 text-xs text-foreground-muted">
          {unresolvableHint ??
            `The account set for this project is no longer connected. ${name} stays paused until you pick an account or reset.`}
        </span>
      ) : null}
    </div>
  );
});
