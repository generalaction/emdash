import { Badge } from '@emdash/ui/react/primitives';
import type { ReactNode } from 'react';
import { cn } from '@core/primitives/styling/browser/cn';
import type { ProviderAccountSummary } from '../api/provider-account-summary';

export function ProviderAccountLabel({
  account,
  layout = 'inline',
  showDefaultBadge = false,
  fallbackIcon,
}: {
  account: ProviderAccountSummary;
  layout?: 'inline' | 'compact' | 'detailed';
  showDefaultBadge?: boolean;
  fallbackIcon?: ReactNode;
}) {
  const avatar = account.avatarUrl ? (
    <img
      src={account.avatarUrl}
      alt={account.displayName}
      className={cn('shrink-0 rounded-full', layout === 'detailed' ? 'size-8' : 'h-4 w-4')}
    />
  ) : fallbackIcon ? (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center',
        layout === 'detailed' ? 'size-8' : 'h-4 w-4'
      )}
    >
      {fallbackIcon}
    </span>
  ) : null;
  const name = (
    <span
      className={cn('min-w-0 truncate', layout === 'detailed' && 'font-medium')}
      title={account.displayName}
    >
      {account.displayName}
    </span>
  );
  const defaultBadge = showDefaultBadge && account.isDefault ? <Badge>Default</Badge> : null;

  if (layout === 'detailed') {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
        {avatar}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            {name}
            {defaultBadge}
            {account.credentialSource ? (
              <Badge variant="outline">
                {providerCredentialSourceLabel(account.credentialSource)}
              </Badge>
            ) : null}
          </div>
          {account.displayDetail ? (
            <span className="truncate text-xs text-foreground-muted">{account.displayDetail}</span>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
      {avatar}
      {name}
      {layout === 'inline' && account.displayDetail ? (
        <span className="text-muted-foreground shrink-0 text-xs">{account.displayDetail}</span>
      ) : null}
      {defaultBadge}
    </div>
  );
}

const CREDENTIAL_SOURCE_LABELS: Record<string, string> = {
  cli: 'CLI',
  emdash_oauth: 'OAuth',
  oauth: 'OAuth',
  device_flow: 'Device flow',
  secure_storage: 'Saved token',
  form: 'Saved credentials',
};

export function providerCredentialSourceLabel(source: string): string {
  return CREDENTIAL_SOURCE_LABELS[source] ?? source;
}
