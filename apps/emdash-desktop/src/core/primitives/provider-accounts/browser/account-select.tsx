import { Select } from '@emdash/ui/react/primitives';
import type { ReactNode } from 'react';
import type { ProviderAccountSummary } from '../api/provider-account-summary';
import { ProviderAccountLabel } from './account-label';

/** Picks a concrete account. The caller owns filtering, defaults, and persistence. */
export function ProviderAccountSelect({
  providerName,
  accounts,
  selectedAccount,
  onAccountChange,
  fallbackIcon,
}: {
  providerName: string;
  accounts: ProviderAccountSummary[];
  selectedAccount: ProviderAccountSummary | null;
  onAccountChange: (accountId: string) => void;
  fallbackIcon?: ReactNode;
}) {
  return (
    <Select.Root
      value={selectedAccount?.accountId ?? null}
      onValueChange={(nextValue) => {
        if (nextValue) onAccountChange(nextValue);
      }}
      disabled={accounts.length === 0}
    >
      <Select.Trigger
        appearance="input"
        size="sm"
        className="max-w-48 min-w-36"
        aria-label={`${providerName} account`}
      >
        {selectedAccount ? (
          <ProviderAccountLabel
            account={selectedAccount}
            layout="compact"
            fallbackIcon={fallbackIcon}
          />
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
            {fallbackIcon ? <span className="size-4 shrink-0">{fallbackIcon}</span> : null}
            <span className="min-w-0 truncate">No {providerName} account</span>
          </span>
        )}
      </Select.Trigger>
      <Select.Content align="end" alignItemWithTrigger={false} sideOffset={6} className="min-w-56">
        {accounts.map((account) => (
          <Select.Item key={account.accountId} value={account.accountId}>
            <ProviderAccountLabel account={account} layout="detailed" fallbackIcon={fallbackIcon} />
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}
