import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { StatusIcon } from '@renderer/lib/components/pr-status-icon';
import { rpc } from '@renderer/lib/ipc';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '@renderer/lib/ui/combobox';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@renderer/lib/ui/select';
import { cn } from '@renderer/utils/utils';
import { pullRequestErrorMessage, type PullRequest } from '@shared/pull-requests';

type StatusFilter = 'open' | 'not-open';

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
            <span className="shrink-0 font-mono text-xs text-foreground-muted">
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

export function PrSelector({
  value,
  onValueChange,
  projectId,
  repositoryUrl = '',
  disabled,
  renderSelectedValue,
  renderPlaceholder,
}: PrSelectorProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');

  // Trigger a background incremental sync when the selector mounts, at most once per 60 s.
  useQuery({
    queryKey: ['pr-sync', projectId],
    queryFn: () => rpc.pullRequests.syncPullRequests(projectId!),
    enabled: !!projectId && !!repositoryUrl,
    staleTime: 60_000,
  });

  const { data } = useQuery({
    queryKey: ['pull-requests-selector', projectId, repositoryUrl, statusFilter],
    queryFn: async () => {
      const response = await rpc.pullRequests.listPullRequests(projectId!, {
        limit: 50,
        offset: 0,
        filters: { status: statusFilter },
        repositoryUrl,
      });
      if (!response?.success) {
        throw new Error(
          response ? pullRequestErrorMessage(response.error) : 'Failed to load pull requests'
        );
      }
      return response.data.prs;
    },
    enabled: !!projectId && !!repositoryUrl,
    staleTime: 30_000,
  });

  const prs = data ?? [];

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
    <Select
      value={statusFilter}
      onValueChange={(v) => {
        if (v === 'open' || v === 'not-open') setStatusFilter(v);
      }}
    >
      <SelectTrigger
        aria-label="Filter by status"
        className="h-6 gap-1 border-none bg-transparent px-1.5 text-xs text-foreground-muted shadow-none hover:text-foreground focus:ring-0"
      >
        {statusFilter === 'open' ? 'Open' : 'Closed'}
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="open">Open</SelectItem>
        <SelectItem value="not-open">Closed</SelectItem>
      </SelectContent>
    </Select>
  );

  return (
    <div className={cn('max-w-full min-w-0 overflow-hidden')}>
      <Combobox
        autoHighlight
        items={prs}
        filter={null}
        itemToStringLabel={(pr: PullRequest | null) =>
          pr ? `${pr.identifier ?? ''} ${pr.title} ${pr.headRefName}` : ''
        }
        value={value}
        onValueChange={(next: PullRequest | null) => onValueChange(next)}
        disabled={disabled}
      >
        <ComboboxTrigger
          render={
            <button className="flex w-full min-w-0 text-left outline-none">
              <ComboboxValue placeholder={placeholderContent}>
                {value ? selectedContent : null}
              </ComboboxValue>
            </button>
          }
        />
        <ComboboxContent
          side="bottom"
          className="min-w-(--anchor-width) pb-1"
          collisionAvoidance={{ side: 'shift' }}
        >
          <ComboboxInput
            rightAddon={statusAddon}
            showClear={!!value}
            showTrigger={false}
            placeholder="Search pull requests…"
            disabled={disabled}
          />
          <ComboboxEmpty>
            <span className="text-muted-foreground">
              {statusFilter === 'open' ? 'No open pull requests' : 'No closed pull requests'}
            </span>
          </ComboboxEmpty>
          <ComboboxList>
            {(pr: PullRequest) => (
              <ComboboxItem key={pr.url} value={pr} className="pr-2" showCheck={false}>
                <PrRow pr={pr} />
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
