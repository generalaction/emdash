import { AlertCircle } from 'lucide-react';
import { ISSUE_PROVIDER_META } from '@renderer/features/integrations/issue-provider-meta';
import { PROVIDER_ICON_COMPONENTS } from '@renderer/features/integrations/provider-icons';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Button } from '@renderer/lib/ui/button';
import { cn } from '@renderer/utils/utils';
import type { LinkedIssue } from '@shared/core/linked-issue';
import type { IssueListError } from '@shared/issue-providers';
import { parseIssueSearchError } from './parse-issue-search-error';

function ProviderIcon({
  provider,
  className,
}: {
  provider: LinkedIssue['provider'];
  className?: string;
}) {
  const Icon = PROVIDER_ICON_COMPONENTS[provider];

  return (
    <span
      role="img"
      aria-label={ISSUE_PROVIDER_META[provider].displayName}
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-visible align-middle leading-none',
        className ?? 'h-3.5 w-3.5'
      )}
    >
      <Icon className="size-[90%]" />
    </span>
  );
}

export function IssueSearchEmptyState({
  provider,
  error,
  errorType,
}: {
  provider: LinkedIssue['provider'] | null;
  error: string | null;
  errorType: IssueListError['type'] | null;
}) {
  const { navigate } = useNavigate();
  const parsed = parseIssueSearchError(provider, error, errorType);

  if (!parsed) {
    return <span>No issues found</span>;
  }

  const openIntegrations = () => navigate('settings', { tab: 'integrations' });

  return (
    <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
      <span
        className={cn(
          'flex size-8 items-center justify-center rounded-full',
          parsed.kind === 'generic' ? 'bg-background-destructive' : 'bg-background-2'
        )}
      >
        {provider && parsed.kind !== 'generic' ? (
          <ProviderIcon provider={provider} className="size-4" />
        ) : (
          <AlertCircle
            className={cn(
              'size-4',
              parsed.kind === 'generic' ? 'text-foreground-destructive' : 'text-foreground-muted'
            )}
          />
        )}
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{parsed.title}</p>
        <p className="max-w-72 text-xs leading-relaxed text-foreground-muted">
          {parsed.description}
        </p>
      </div>
      {parsed.actionLabel ? (
        <Button type="button" variant="outline" size="xs" onClick={openIntegrations}>
          {parsed.actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
