import { ExternalLink, Link2, Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { forwardRef, useCallback, useRef, useState } from 'react';
import {
  ISSUE_PROVIDER_META,
  ISSUE_PROVIDER_ORDER,
} from '@renderer/features/integrations/issue-provider-meta';
import { PROVIDER_ICON_COMPONENTS } from '@renderer/features/integrations/provider-icons';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import type { Issue } from '@shared/tasks';
import { getLinkedIssueMap, type LinkedIssueInfo } from './use-linked-issue-urls';
import { useIssueSearch } from './useIssueSearch';

function getStatusColorClass(status?: string) {
  if (!status) return '';
  const s = status.toLowerCase();
  if (s.includes('blocked') || s.includes('cancelled') || s.includes('canceled'))
    return 'bg-foreground-error';
  if (
    s.includes('done') ||
    s.includes('closed') ||
    s.includes('resolved') ||
    s.includes('completed')
  )
    return 'bg-foreground-success';
  if (s.includes('progress') || s.includes('review')) return 'bg-foreground-warning';
  return 'bg-foreground-passive';
}

export function IssueIdentifier({
  identifier,
  provider,
}: {
  identifier: string;
  provider?: Issue['provider'];
}) {
  if (provider === 'asana') return null;
  return (
    <span className="text-muted-foreground group-hover:text-muted-foreground shrink-0 font-mono text-xs font-medium whitespace-nowrap">
      {identifier}
    </span>
  );
}

export const StatusDot = forwardRef<HTMLSpanElement, { status?: string }>(
  ({ status, ...props }, ref) => {
    if (!status) return null;
    const color = getStatusColorClass(status);
    return (
      <span
        ref={ref}
        {...props}
        className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', color)}
      />
    );
  }
);

export function ProviderLogo({
  provider,
  className,
}: {
  provider: Issue['provider'];
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

function IssuePriorityIcon({
  provider,
  priority,
  className,
  reserveSpace = false,
}: {
  provider: Issue['provider'];
  priority?: string;
  className?: string;
  reserveSpace?: boolean;
}) {
  if (provider !== 'linear') return null;

  if (!priority || priority.toLowerCase() === 'no priority') {
    return reserveSpace ? <span className={cn('w-3 shrink-0', className)} /> : null;
  }

  const normalizedPriority = priority.toLowerCase();
  const activeBars = normalizedPriority === 'high' ? 3 : normalizedPriority === 'medium' ? 2 : 1;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          normalizedPriority === 'urgent' ? (
            <span
              className={cn(
                'flex h-3 w-3 shrink-0 items-center justify-center rounded-[3px] bg-foreground-error text-[9px] leading-none font-bold text-white',
                className
              )}
            >
              !
            </span>
          ) : (
            <span
              className={cn(
                'flex h-3 w-3 shrink-0 items-end justify-center gap-px text-foreground-muted',
                className
              )}
            >
              {[1, 2, 3].map((bar) => (
                <span
                  key={bar}
                  className={cn(
                    'w-1 rounded-full bg-current',
                    bar === 1 && 'h-1',
                    bar === 2 && 'h-2',
                    bar === 3 && 'h-3',
                    bar > activeBars && 'opacity-25'
                  )}
                />
              ))}
            </span>
          )
        }
      />
      <TooltipContent>Priority: {priority}</TooltipContent>
    </Tooltip>
  );
}

export function hasMeaningfulPriority(issue: Issue): boolean {
  if (issue.provider !== 'linear') return false;

  const priority = issue.priority?.toLowerCase();
  return !!priority && priority !== 'no priority';
}

function shouldShowStatusDot(issue: Issue): boolean {
  if (!issue.status) return false;
  return !(issue.provider === 'github' && issue.status.toLowerCase() === 'open');
}

export function LinkedIssueIndicator({ linkedTo }: { linkedTo: LinkedIssueInfo }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="ml-auto flex shrink-0 items-center text-foreground-muted">
            <Link2 className="size-3.5" />
          </span>
        }
      />
      <TooltipContent>Already linked to task: {linkedTo.taskName}</TooltipContent>
    </Tooltip>
  );
}

export function IssueRow({
  issue,
  linkedTo,
  reservePrioritySpace = true,
}: {
  issue: Issue;
  linkedTo?: LinkedIssueInfo;
  reservePrioritySpace?: boolean;
}) {
  return (
    <span className="flex w-full min-w-0 items-center gap-3">
      <IssuePriorityIcon
        provider={issue.provider}
        priority={issue.priority}
        reserveSpace={reservePrioritySpace}
      />
      <IssueIdentifier identifier={issue.identifier} provider={issue.provider} />
      {shouldShowStatusDot(issue) ? (
        <Tooltip>
          <TooltipTrigger render={<StatusDot status={issue.status} />} />
          <TooltipContent>{issue.status}</TooltipContent>
        </Tooltip>
      ) : null}
      {issue.title ? <span className="truncate text-foreground">{issue.title}</span> : null}
      {linkedTo ? <LinkedIssueIndicator linkedTo={linkedTo} /> : null}
    </span>
  );
}

export interface IssueSelectorProps {
  value: Issue | null;
  onValueChange: (issue: Issue | null) => void;
  projectId?: string;
  repositoryUrl: string;
  projectPath?: string;
  /** Skip "already linked" indicator for this task — useful when re-selecting the same task's issue. */
  excludeTaskId?: string;
}

export const IssueSelector = observer(function IssueSelector({
  projectId,
  repositoryUrl,
  projectPath = '',
  value,
  onValueChange,
  excludeTaskId,
}: IssueSelectorProps) {
  const linkedIssueMap = getLinkedIssueMap(projectId, excludeTaskId);
  const {
    issues,
    issueProvider,
    hasAnyIntegration,
    isProviderLoading,
    isProviderDisabled,
    connectedProviderCount,
    handleSetSearchTerm,
    setSelectedIssueProvider,
  } = useIssueSearch(repositoryUrl, projectPath, projectId);

  const [comboboxOpen, setComboboxOpen] = useState(false);
  const providerSelectOpenRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reservePrioritySpace = issues.some(hasMeaningfulPriority);

  const handleSelectIssueProvider = useCallback(
    (provider: Issue['provider']) => {
      setSelectedIssueProvider(provider);
      if (value?.provider !== provider) {
        onValueChange(null);
      }
    },
    [setSelectedIssueProvider, value, onValueChange]
  );

  const leftAddon = issueProvider ? (
    isProviderLoading ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground/60" />
    ) : connectedProviderCount > 1 ? (
      <Select
        value={issueProvider}
        onValueChange={(v) => v && handleSelectIssueProvider(v as Issue['provider'])}
        onOpenChange={(open) => {
          providerSelectOpenRef.current = open;
          if (open) {
            setComboboxOpen(true);
          } else {
            requestAnimationFrame(() => inputRef.current?.focus());
          }
        }}
      >
        <SelectTrigger
          aria-label="Select issue provider"
          className="h-6 gap-1 border-none bg-transparent px-1.5 shadow-none focus:ring-0"
        >
          <ProviderLogo provider={issueProvider} className="h-3.5 w-3.5" />
        </SelectTrigger>
        <SelectContent>
          {ISSUE_PROVIDER_ORDER.map((p) => (
            <SelectItem key={p} value={p} disabled={isProviderDisabled(p)}>
              <ProviderLogo provider={p} className="h-3.5 w-3.5" />
              <span>{ISSUE_PROVIDER_META[p].displayName}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : (
      <span className="mx-1.5 flex items-center">
        <ProviderLogo provider={issueProvider} className="h-3.5 w-3.5" />
      </span>
    )
  ) : null;

  return (
    <div className="max-w-full min-w-0 overflow-hidden">
      {hasAnyIntegration ? (
        <Combobox
          autoHighlight
          items={issues}
          filter={null}
          itemToStringLabel={(issue: Issue | null) =>
            issue ? `${issue.identifier} ${issue.title}` : ''
          }
          value={value}
          onValueChange={(next: Issue | null) => onValueChange(next)}
          onInputValueChange={(val: string, { reason }: { reason: string }) => {
            if (reason !== 'item-press') handleSetSearchTerm(val);
          }}
          disabled={!hasAnyIntegration}
          open={comboboxOpen}
          onOpenChange={(open) => {
            if (!open && providerSelectOpenRef.current) return;
            setComboboxOpen(open);
          }}
        >
          <ComboboxTrigger
            render={
              <button
                className={cn(
                  'flex min-w-0 w-full items-start border border-border hover:bg-muted/30 hover:shadow-xs rounded-md p-3 text-left text-sm outline-none',
                  !value && 'border-dashed'
                )}
              >
                <ComboboxValue
                  placeholder={
                    <div className="flex h-6 w-full items-center justify-center gap-1 text-center text-sm text-foreground-passive">
                      Click to link an issue
                    </div>
                  }
                >
                  {value ? <SelectedIssueValue issue={value} /> : null}
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
              leftAddon={leftAddon}
              inputRef={inputRef}
              showClear={!!value}
              showTrigger={false}
              placeholder={`Search ${issueProvider ? ISSUE_PROVIDER_META[issueProvider].displayName : 'issues'}…`}
              disabled={!hasAnyIntegration}
            />
            <ComboboxEmpty>
              <span className="text-muted-foreground">No issues found</span>
            </ComboboxEmpty>
            <ComboboxList>
              {(issue: Issue) => {
                const linkedTo = linkedIssueMap.get(issue.url);
                return (
                  <ComboboxItem key={issue.identifier} value={issue} className="pr-2">
                    <IssueRow
                      issue={issue}
                      linkedTo={linkedTo}
                      reservePrioritySpace={reservePrioritySpace}
                    />
                  </ComboboxItem>
                );
              }}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      ) : (
        <ConnectIssueIntegrationPlaceholder />
      )}
    </div>
  );
});

export function SelectedIssueValue({ issue }: { issue: Issue }) {
  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex w-full items-center justify-between">
        <div className="flex items-center gap-2">
          <ProviderLogo provider={issue.provider} className="h-3.5 w-3.5" />
          <span>{`${ISSUE_PROVIDER_META[issue.provider].displayName} issue`}</span>
          <IssuePriorityIcon provider={issue.provider} priority={issue.priority} />
          <IssueIdentifier identifier={issue.identifier} provider={issue.provider} />
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={!issue.url}
          onClick={() => issue.url && rpc.app.openExternal(issue.url)}
        >
          <ExternalLink className="size-3" />
        </Button>
      </div>
      {issue.title ? (
        <div className="text-muted-foreground min-w-0 truncate">{issue.title}</div>
      ) : null}
      <div className="relative flex items-center gap-2">
        {issue.status ? (
          <Badge
            variant="outline"
            className="flex items-center gap-2 rounded-md text-xs font-normal"
          >
            <StatusDot status={issue.status} />
            {issue.status}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

export function ConnectIssueIntegrationPlaceholder() {
  const { navigate } = useNavigate();

  return (
    <div className="flex w-full flex-col items-center justify-center gap-5 rounded-md border border-dashed border-border p-8">
      <div className="flex items-center justify-center [&>span]:ring-2 [&>span]:ring-background-quaternary [&>span:not(:first-child)]:-ml-1.5">
        {ISSUE_PROVIDER_ORDER.map((provider) => (
          <span
            key={provider}
            className="relative flex size-8 items-center justify-center overflow-hidden rounded-full bg-background-quaternary-2"
          >
            <ProviderLogo provider={provider} className="size-4" />
          </span>
        ))}
      </div>
      <p className="font-nomral text-center text-sm text-foreground-muted">
        Connect with one of our issue integrations to link your issues to your tasks and use them as
        context in your conversations.
      </p>
      <Button
        variant="outline"
        size="xs"
        className="w-fit"
        onClick={() => navigate('settings', { tab: 'integrations' })}
      >
        Configure integrations
      </Button>
    </div>
  );
}
