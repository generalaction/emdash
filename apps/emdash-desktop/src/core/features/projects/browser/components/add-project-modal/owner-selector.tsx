import { Combobox, TriggerButton } from '@emdash/ui/react/primitives';
import { GithubIcon } from 'lucide-react';
import { useState } from 'react';
import type { ProviderAccountSummary } from '@core/primitives/provider-accounts/api/provider-account-summary';
import { ProviderAccountSelect } from '@core/primitives/provider-accounts/browser/account-select';

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
  accounts: ProviderAccountSummary[];
  selectedAccount: ProviderAccountSummary | null;
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
          <div className="min-w-0" onKeyDown={(event) => event.stopPropagation()}>
            <ProviderAccountSelect
              providerName="GitHub"
              accounts={accounts}
              selectedAccount={selectedAccount}
              onAccountChange={onAccountChange}
              fallbackIcon={<GithubIcon className="size-full text-foreground-muted" />}
            />
          </div>
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
