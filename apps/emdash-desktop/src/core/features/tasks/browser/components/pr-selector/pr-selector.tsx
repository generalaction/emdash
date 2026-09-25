import { ListPopoverCard } from '@emdash/ui/react/components';
import { Button, Combobox, Select } from '@emdash/ui/react/primitives';
import { remote, type RemoteModel } from '@emdash/wire/state';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Github } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { type ReactNode, useState } from 'react';
import { providerAccountReportingState } from '@core/features/integrations/api/account-reporting';
import { useProjectAccount } from '@core/features/integrations/api/browser/use-project-account';
import { useAccounts } from '@core/features/integrations/api/browser/use-provider-accounts';
import { ProviderAccountStateEmpty } from '@core/features/integrations/contributions/browser/account-state';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { useDebounce } from '@core/primitives/react-hooks/browser/useDebounce';
import { cn } from '@core/primitives/styling/browser/cn';
import { useRemoteModelState } from '@core/primitives/wire/browser/use-remote-model-state';
import {
  pullRequestErrorMessage,
  pullRequestsContract,
  type PullRequest,
} from '@root/src/core/services/pull-requests/api';
import { getPullRequestsRuntimeClient } from '@root/src/core/services/pull-requests/api/client';
import { StatusIcon } from '@root/src/core/services/pull-requests/browser/components/pr-status-icon';

type StatusFilter = 'open' | 'not-open';

let syncRemotePromise: Promise<RemoteModel<typeof pullRequestsContract.syncState>> | undefined;

function getSyncRemote() {
  syncRemotePromise ??= getPullRequestsRuntimeClient().then((client) =>
    remote(pullRequestsContract.syncState, client.syncState, { lingerMs: 15_000 })
  );
  return syncRemotePromise;
}

export interface PrSelectorProps {
  value: PullRequest | null;
  onValueChange: (pr: PullRequest | null) => void;
  projectId?: string;
  repositoryUrl?: string;
  disabled?: boolean;
  renderSelectedValue?: (pr: PullRequest) => ReactNode;
  renderPlaceholder?: () => ReactNode;
}

export function PrRow({ pr }: { pr: PullRequest }) {
  return (
    <div className="flex w-full min-w-0 items-start gap-2">
      <div className="shrink-0 pt-0.5">
        <StatusIcon className="size-3.5" pr={pr} disableTooltip />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm text-foreground">{pr.title}</span>
          {pr.identifier && (
            <span className="shrink-0 font-sans text-xs text-foreground-muted">
              {pr.identifier}
            </span>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-1 text-xs text-foreground-muted">
          {pr.author && (
            <>
              <span className="shrink-0">{pr.author.userName}</span>
              <span className="shrink-0">·</span>
            </>
          )}
          <code className="truncate text-xs">{pr.headRefName}</code>
        </div>
      </div>
    </div>
  );
}

export function SelectedPrValue({ pr }: { pr: PullRequest }) {
  return <PrRow pr={pr} />;
}

export const PrSelector = observer(function PrSelector({
  value,
  onValueChange,
  projectId,
  repositoryUrl = '',
  disabled,
  renderSelectedValue,
  renderPlaceholder,
}: PrSelectorProps) {
  const openIntegrationSetup = useOpenModal('integrationSetupModal');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query.trim(), 200);
  const searchQuery = query.trim() ? debouncedQuery : '';

  // §7 reporting matrix over the resolver provenance (spec:
  // github-git-settings §7): an explicitly disabled project or an
  // unresolvable pin must not trigger syncs — fail closed instead of
  // proceeding as another identity.
  const account = useProjectAccount(projectId ?? '', 'github', { repository: { kind: 'project' } });
  const { data: accounts } = useAccounts('github');
  const accountState =
    projectId && account?.value === null && accounts
      ? providerAccountReportingState('GitHub', account.provenance, accounts.length > 0)
      : null;
  const enabled =
    !!projectId && !!repositoryUrl && (!accountState || accountState.kind === 'silent');
  // Inventory owns provider reads. Subscribe only to its local cache revision/status.
  const sync = useRemoteModelState(
    pullRequestsContract.syncState,
    getSyncRemote,
    { repositoryUrl },
    'state',
    { enabled }
  );

  const { data: listResult, isLoading } = useQuery({
    queryKey: [
      'pull-requests-selector',
      projectId,
      repositoryUrl,
      statusFilter,
      searchQuery,
      sync.value?.revision,
    ],
    queryFn: async () => {
      const client = await getPullRequestsRuntimeClient();
      return await client.listPullRequests({
        repositoryUrls: [repositoryUrl],
        cursor: null,
        limit: 50,
        filters: { status: statusFilter },
        searchQuery: searchQuery || undefined,
      });
    },
    enabled,
    staleTime: 30_000,
  });

  const prs = listResult?.success ? listResult.data.prs : [];
  const syncError = enabled ? sync.value?.error : null;
  const listError = listResult && !listResult.success ? listResult.error : null;
  const error = syncError ?? listError;
  const errorMessage = error ? pullRequestErrorMessage(error) : null;
  const isGitHubAuthError =
    error?.type === 'github_auth_required' ||
    error?.type === 'ghes_auth_required' ||
    error?.type === 'github_account_not_found' ||
    error?.type === 'github_account_host_mismatch' ||
    error?.type === 'github_token_missing' ||
    error?.type === 'github_sso_required';
  const githubAuthDescription =
    error?.type === 'github_account_not_found'
      ? 'The selected GitHub account is no longer connected. Reconnect GitHub to show pull requests for this repository.'
      : 'Emdash needs a connected GitHub account before it can show pull requests for this repository.';
  const connectGitHubButton = (
    <Button
      type="button"
      variant="secondary"
      size="xs"
      onClick={() => void openIntegrationSetup({ integration: 'github' })}
    >
      Connect GitHub
    </Button>
  );

  const selectedContent = renderSelectedValue ? (
    renderSelectedValue(value!)
  ) : (
    <div className="hover:bg-muted/30 flex w-full min-w-0 items-start rounded-md border border-border p-3 text-left text-sm hover:shadow-xs">
      <SelectedPrValue pr={value!} />
    </div>
  );

  const placeholderContent = renderPlaceholder ? (
    renderPlaceholder()
  ) : (
    <div className="hover:bg-muted/30 flex h-6 w-full items-center justify-center gap-1 rounded-md border border-dashed border-border p-3 text-center text-sm text-foreground-passive hover:shadow-xs">
      Click to select a pull request
    </div>
  );

  const statusAddon = (
    <Select.Root
      value={statusFilter}
      onValueChange={(v) => {
        if (v === 'open' || v === 'not-open') {
          setStatusFilter(v);
          setQuery('');
        }
      }}
    >
      <Select.Trigger
        aria-label="Filter by status"
        className="h-6 gap-1 border-none bg-transparent px-1.5 text-xs text-foreground-muted shadow-none hover:text-foreground focus:ring-0"
      >
        {statusFilter === 'open' ? 'Open' : 'Closed'}
      </Select.Trigger>
      <Select.Content align="end">
        <Select.Item value="open">Open</Select.Item>
        <Select.Item value="not-open">Closed</Select.Item>
      </Select.Content>
    </Select.Root>
  );

  return (
    <div className={cn('max-w-full min-w-0 overflow-hidden')}>
      <Combobox.Root
        autoHighlight
        items={prs}
        filter={null}
        itemToStringLabel={(pr: PullRequest | null) =>
          pr ? `${pr.identifier ?? ''} ${pr.title} ${pr.headRefName}` : ''
        }
        value={value}
        onValueChange={(next: PullRequest | null) => {
          onValueChange(next);
          setQuery('');
        }}
        inputValue={query}
        onInputValueChange={(nextQuery: string, { reason }: { reason: string }) => {
          if (reason !== 'item-press') setQuery(nextQuery);
        }}
        disabled={disabled}
      >
        <Combobox.Trigger
          render={
            <button className="flex w-full min-w-0 text-left outline-none">
              <Combobox.Value placeholder={placeholderContent}>
                {value ? selectedContent : null}
              </Combobox.Value>
            </button>
          }
        />
        <Combobox.Content
          side="bottom"
          className="min-w-(--anchor-width) pb-1"
          collisionAvoidance={{ side: 'shift' }}
        >
          <Combobox.Input
            rightAddon={statusAddon}
            showClear={!!value}
            showTrigger={false}
            placeholder="Search pull requests…"
            disabled={disabled}
          />
          <Combobox.Empty>
            {accountState && accountState.kind !== 'silent' ? (
              <ProviderAccountStateEmpty
                state={accountState}
                projectId={projectId}
                providerId="github"
                providerName="GitHub"
                icon={<Github className="size-4 text-foreground-muted" />}
              />
            ) : isGitHubAuthError ? (
              <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
                <span className="flex size-8 items-center justify-center rounded-full bg-background-2">
                  <Github className="size-4 text-foreground-muted" />
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">Connect GitHub to load PRs</p>
                  <p className="max-w-64 text-xs text-foreground-muted">{githubAuthDescription}</p>
                </div>
                {connectGitHubButton}
              </div>
            ) : (
              <span className={cn(errorMessage && 'text-foreground-error')}>
                {errorMessage ??
                  (enabled && (isLoading || sync.isLoading || sync.value?.phase === 'running')
                    ? 'Loading pull requests…'
                    : statusFilter === 'open'
                      ? 'No open pull requests'
                      : 'No closed pull requests')}
              </span>
            )}
          </Combobox.Empty>
          <Combobox.List>
            {(pr: PullRequest) => (
              <Combobox.Item key={pr.url} value={pr} className="pr-2" showCheck={false}>
                <PrRow pr={pr} />
              </Combobox.Item>
            )}
          </Combobox.List>
          {errorMessage && prs.length > 0 && (
            <ListPopoverCard status="destructive" className="text-foreground-destructive">
              <AlertCircle className="size-3.5 shrink-0 text-foreground-destructive" />
              <span className="shrink-0 font-medium text-foreground-destructive">Sync failed</span>
              <span
                className="min-w-0 grow truncate text-foreground-destructive/80"
                title={errorMessage}
              >
                {errorMessage}
              </span>
              {isGitHubAuthError && connectGitHubButton}
            </ListPopoverCard>
          )}
        </Combobox.Content>
      </Combobox.Root>
    </div>
  );
});
