import { Combobox, Select, TriggerButton } from '@emdash/ui/react/primitives';
import { GithubIcon } from 'lucide-react';
import { useState } from 'react';
import {
  GitHubAccountSelectListItem,
  GitHubAccountSelectTrigger,
} from '@core/features/projects/contributions/browser/github-account-select';
import type { GitHubAccountSummary } from '@core/primitives/github/api';

export interface OwnerOption {
  value: string;
  label: string;
  avatarUrl: string;
}

export function OwnerSelector({
  owners,
  owner,
  accounts,
  selectedAccount,
  onOwnerChange,
  onAccountChange,
}: {
  owners: OwnerOption[];
  owner: OwnerOption | null;
  accounts: GitHubAccountSummary[];
  selectedAccount: GitHubAccountSummary | null;
  onOwnerChange: (owner: OwnerOption) => void;
  onAccountChange: (accountId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Combobox.Root
      items={owners}
      value={owner}
      open={open}
      onOpenChange={setOpen}
      onValueChange={(nextOwner: OwnerOption | null) => {
        if (!nextOwner) return;
        onOwnerChange(nextOwner);
        setOpen(false);
      }}
      isItemEqualToValue={(a: OwnerOption, b: OwnerOption) => a.value === b.value}
      filter={(item: OwnerOption, query: string) =>
        item.label.toLowerCase().includes(query.toLowerCase())
      }
      autoHighlight
    >
      <Combobox.Trigger
        render={
          <TriggerButton
            appearance="input"
            size="base"
            tone="neutral"
            className="w-full justify-between"
            aria-label="Repository owner"
          />
        }
      >
        <span className="min-w-0 truncate">{owner?.label ?? 'Choose owner'}</span>
      </Combobox.Trigger>
      <Combobox.Content align="start" sideOffset={6} style={{ minWidth: '20rem' }}>
        <div className="flex items-center justify-between gap-3 px-2 py-1.5">
          <span className="text-xs text-foreground-muted">Choose</span>
          <GitHubAccountSelect
            accounts={accounts}
            selectedAccount={selectedAccount}
            onAccountChange={onAccountChange}
          />
        </div>
        <Combobox.Separator />
        <Combobox.Input showTrigger={false} placeholder="Search owners..." />
        <Combobox.List>
          {owners.map((item) => (
            <Combobox.Item key={item.value} value={item}>
              <span className="flex min-w-0 items-center gap-2">
                {item.avatarUrl ? (
                  <img
                    src={item.avatarUrl}
                    alt={item.label}
                    className="size-4 shrink-0 rounded-full"
                  />
                ) : (
                  <GithubIcon className="size-4 shrink-0 text-foreground-muted" />
                )}
                <span className="min-w-0 truncate">{item.label}</span>
              </span>
            </Combobox.Item>
          ))}
          <Combobox.Empty>No owners found.</Combobox.Empty>
        </Combobox.List>
      </Combobox.Content>
    </Combobox.Root>
  );
}

function GitHubAccountSelect({
  accounts,
  selectedAccount,
  onAccountChange,
}: {
  accounts: GitHubAccountSummary[];
  selectedAccount: GitHubAccountSummary | null;
  onAccountChange: (accountId: string) => void;
}) {
  return (
    <div className="min-w-0" onKeyDown={(event) => event.stopPropagation()}>
      <Select.Root
        value={selectedAccount?.accountId}
        onValueChange={(nextValue) => {
          if (nextValue) onAccountChange(nextValue);
        }}
        disabled={accounts.length === 0}
      >
        <Select.Trigger appearance="input" size="sm" className="max-w-48 min-w-36">
          {selectedAccount ? (
            <GitHubAccountSelectTrigger account={selectedAccount} />
          ) : (
            <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <GithubIcon className="size-4 shrink-0 text-foreground-muted" />
              <span className="min-w-0 truncate">No GitHub account</span>
            </span>
          )}
        </Select.Trigger>
        <Select.Content
          align="end"
          alignItemWithTrigger={false}
          sideOffset={6}
          className="min-w-56"
        >
          {accounts.map((account) => (
            <Select.Item key={account.accountId} value={account.accountId}>
              <GitHubAccountSelectListItem account={account} />
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </div>
  );
}
