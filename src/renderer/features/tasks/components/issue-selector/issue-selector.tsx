import { ExternalLink, Loader2 } from 'lucide-react';
import { forwardRef, useCallback, useRef, useState } from 'react';
import type { Issue } from '@shared/tasks';
import {
  ISSUE_PROVIDER_META,
  ISSUE_PROVIDER_ORDER,
} from '@renderer/features/integrations/issue-provider-meta';
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
import { useIssueSearch } from './useIssueSearch';

function getStatusColorClass(status?: string) {
  if (!status) return '';
  const s = status.toLowerCase();
  if (
    s.includes('done') ||
    s.includes('closed') ||
    s.includes('resolved') ||
    s.includes('completed')
  )
    return 'bg-emerald-500 ';
  if (s.includes('progress') || s.includes('review') || s.includes('open')) return 'bg-yellow-500';
  if (s.includes('blocked') || s.includes('cancelled') || s.includes('canceled'))
    return 'bg-red-500';
  return 'bg-gray-300';
}

export function IssueIdentifier({ identifier }: { identifier: string }) {
  return (
    <span className="shrink-0 whitespace-nowrap font-medium text-muted-foreground group-hover:text-muted-foreground text-xs font-mono">
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
  const meta = ISSUE_PROVIDER_META[provider];
  const src = meta.logo;
  const alt = meta.displayName;
  return <img src={src} alt={alt} className={className ?? 'h-3.5 w-3.5'} />;
}

export function IssueRow({ issue }: { issue: Issue }) {
  return (
    <span className="flex min-w-0 items-center gap-2 w-full">
      <Tooltip>
        <TooltipTrigger render={<StatusDot status={issue.status} />} />
        <TooltipContent>{issue.status}</TooltipContent>
      </Tooltip>
      <IssueIdentifier identifier={issue.identifier} />
      {issue.title ? <span className="truncate text-foreground">{issue.title}</span> : null}
    </span>
  );
}

export interface IssueSelectorProps {
  value: Issue | null;
  onValueChange: (issue: Issue | null) => void;
  projectId?: string;
  repositoryUrl: string;
  projectPath?: string;
}

export function IssueSelector({
  projectId,
  repositoryUrl,
  projectPath = '',
  value,
  onValueChange,
}: IssueSelectorProps) {
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
          showChevron={false}
          className="h-6 gap-0 border-none bg-transparent px-1.5 shadow-none focus:ring-0"
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
    <div className="min-w-0 max-w-full overflow-hidden">
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
                    <div className="text-foreground-passive justify-center w-full text-sm text-center flex items-center gap-1 h-6">
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
              placeholder={`Search ${issueProvider ?? 'issues'}…`}
              disabled={!hasAnyIntegration}
            />
            <ComboboxEmpty>
              <span className="text-muted-foreground">No issues found</span>
            </ComboboxEmpty>
            <ComboboxList>
              {(issue: Issue) => (
                <ComboboxItem key={issue.identifier} value={issue} className="pr-2">
                  <IssueRow issue={issue} />
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      ) : (
        <ConnectIssueIntegrationPlaceholder />
      )}
    </div>
  );
}

export function SelectedIssueValue({ issue }: { issue: Issue }) {
  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center justify-between w-full ">
        <div className="flex items-center gap-2">
          <ProviderLogo provider={issue.provider} className="h-3.5 w-3.5" />
          <span>{`${ISSUE_PROVIDER_META[issue.provider].displayName} issue`}</span>
          <IssueIdentifier identifier={issue.identifier} />
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
        <div className="min-w-0 truncate text-muted-foreground">{issue.title}</div>
      ) : null}
      <div className="flex items-center justify-between gap-2 relative">
        <Badge variant="outline" className="flex items-center gap-2 rounded-md font-normal text-xs">
          <StatusDot status={issue.status} />
          {issue.status}
        </Badge>
      </div>
    </div>
  );
}

export function ConnectIssueIntegrationPlaceholder() {
  const { navigate } = useNavigate();

  return (
    <div className="flex flex-col gap-5 w-full border border-border border-dashed items-center justify-center rounded-md p-8">
      <div className="flex items-center justify-center [&>span]:ring-2 [&>span]:ring-background-quaternary [&>span:not(:first-child)]:-ml-1.5">
        {ISSUE_PROVIDER_ORDER.map((provider) => (
          <span
            key={provider}
            className="relative flex items-center justify-center size-8 rounded-full bg-background-quaternary-2 overflow-hidden"
          >
            <ProviderLogo provider={provider} className="size-4" />
          </span>
        ))}
      </div>
      <p className="text-foreground-muted font-nomral text-sm text-center">
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
