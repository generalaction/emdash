import { ExternalLink, Loader2, XIcon } from 'lucide-react';
import { forwardRef, useCallback, useMemo, useRef, useState } from 'react';
import githubLogo from '@/assets/images/github.png';
import jiraLogo from '@/assets/images/jira.png';
import linearLogo from '@/assets/images/Linear.svg';
import type { Issue } from '@shared/tasks';
import { useGitHubIssues } from '@renderer/core/integrations/use-github-issues';
import { useJiraIssues } from '@renderer/core/integrations/use-jira-issues';
import { useLinearIssues } from '@renderer/core/integrations/use-linear-issues';
import { rpc } from '@renderer/core/ipc';
import { useNavigate } from '@renderer/core/view/navigation-provider';
import { cn } from '@renderer/lib/utils';
import { useIntegrationStatus } from './hooks/useIntegrationStatus';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from './ui/combobox';
import { Select, SelectContent, SelectItem, SelectTrigger } from './ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

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

function IssueIdentifier({ identifier }: { identifier: string }) {
  return (
    <span className="shrink-0 whitespace-nowrap font-medium text-muted-foreground group-hover:text-muted-foreground text-xs font-mono">
      {identifier}
    </span>
  );
}

const StatusDot = forwardRef<HTMLSpanElement, { status?: string }>(({ status, ...props }, ref) => {
  if (!status) return null;
  const color = getStatusColorClass(status);
  return (
    <span
      ref={ref}
      {...props}
      className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', color)}
    />
  );
});

function ProviderLogo({
  provider,
  className,
}: {
  provider: Issue['provider'];
  className?: string;
}) {
  const src = provider === 'linear' ? linearLogo : provider === 'github' ? githubLogo : jiraLogo;
  const alt = provider === 'linear' ? 'Linear' : provider === 'github' ? 'GitHub' : 'Jira';
  return <img src={src} alt={alt} className={className ?? 'h-3.5 w-3.5'} />;
}

function IssueRow({ issue }: { issue: Issue }) {
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

const ISSUE_PROVIDERS = ['linear', 'github', 'jira'] as const;

export interface IssueSelectorProps {
  value: Issue | null;
  onValueChange: (issue: Issue | null) => void;
  nameWithOwner: string;
}

export function IssueSelector({ nameWithOwner, value, onValueChange }: IssueSelectorProps) {
  const { isLinearConnected, isGithubConnected, isJiraConnected } = useIntegrationStatus();
  const [selectedIssueProvider, setSelectedIssueProvider] = useState<Issue['provider'] | null>(
    null
  );
  const [comboboxOpen, setComboboxOpen] = useState(false);
  const providerSelectOpenRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSelectIssueProvider = (provider: Issue['provider']) => {
    setSelectedIssueProvider(provider);
    if (value?.provider !== provider) {
      onValueChange(null);
    }
  };

  const linearIssues = useLinearIssues({ enabled: isLinearConnected === true });
  const githubIssues = useGitHubIssues({
    nameWithOwner,
    enabled: isGithubConnected && !!nameWithOwner,
  });
  const jiraIssues = useJiraIssues({ enabled: isJiraConnected === true });

  const hasAnyIntegration = isLinearConnected || isGithubConnected || isJiraConnected;

  const issueProvider = useMemo(() => {
    if (!selectedIssueProvider) {
      if (isLinearConnected) return 'linear' as const;
      if (isGithubConnected) return 'github' as const;
      if (isJiraConnected) return 'jira' as const;
    }
    return selectedIssueProvider;
  }, [isLinearConnected, isGithubConnected, isJiraConnected, selectedIssueProvider]);

  const handleSetSearchTerm = useCallback(
    (term: string) => {
      switch (issueProvider) {
        case 'linear':
          return linearIssues.setSearchTerm(term);
        case 'github':
          return githubIssues.setSearchTerm(term);
        case 'jira':
          return jiraIssues.setSearchTerm(term);
        default:
          return null;
      }
    },
    [issueProvider, linearIssues, githubIssues, jiraIssues]
  );

  const isProviderDisabled = useCallback(
    (provider: Issue['provider']) => {
      if (!hasAnyIntegration) return true;
      if (provider === 'linear') return !isLinearConnected;
      if (provider === 'github') return !isGithubConnected;
      if (provider === 'jira') return !isJiraConnected;
      return false;
    },
    [hasAnyIntegration, isLinearConnected, isGithubConnected, isJiraConnected]
  );

  const issues = useMemo(() => {
    if (!issueProvider) return [];
    if (issueProvider === 'linear') return linearIssues.issues;
    if (issueProvider === 'github') return githubIssues.issues;
    if (issueProvider === 'jira') return jiraIssues.issues;
    return [];
  }, [issueProvider, linearIssues.issues, githubIssues.issues, jiraIssues.issues]);

  const activeHook =
    issueProvider === 'linear'
      ? linearIssues
      : issueProvider === 'github'
        ? githubIssues
        : jiraIssues;

  const isProviderLoading = !!issueProvider && (activeHook.isLoading || activeHook.isSearching);

  const connectedProviderCount = [isLinearConnected, isGithubConnected, isJiraConnected].filter(
    Boolean
  ).length;

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
          {ISSUE_PROVIDERS.map((p) => (
            <SelectItem key={p} value={p} disabled={isProviderDisabled(p)}>
              <ProviderLogo provider={p} className="h-3.5 w-3.5" />
              <span className="capitalize">{p}</span>
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
                    <div className="text-muted-foreground justify-center w-full text-md text-center flex items-center gap-1 h-[76px]">
                      Click to select an issue
                    </div>
                  }
                >
                  {value ? (
                    <SelectedIssueValue issue={value} onRemove={() => onValueChange(null)} />
                  ) : null}
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

function SelectedIssueValue({ issue, onRemove }: { issue: Issue; onRemove: () => void }) {
  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center justify-between w-full ">
        <div className="flex items-center gap-2">
          <ProviderLogo provider={issue.provider} className="h-3.5 w-3.5" />
          <span className="capitalize">{issue.provider + ' issue'}</span>
          <IssueIdentifier identifier={issue.identifier} />
        </div>
        <Button variant="ghost" size="icon-xs" className="-mt-1 -mr-1" onClick={onRemove}>
          <XIcon className="size-3" />
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
        <Button
          variant="ghost"
          size="icon-xs"
          className="-mr-1 -mb-1"
          disabled={!issue.url}
          onClick={() => issue.url && rpc.app.openExternal(issue.url)}
        >
          <ExternalLink className="size-3" />
        </Button>
      </div>
    </div>
  );
}

function ConnectIssueIntegrationPlaceholder() {
  const { navigate } = useNavigate();

  return (
    <div className="flex flex-col gap-4 w-full border border-border border-dashed items-center justify-center rounded-md p-4">
      <div className="flex items-center gap-2 w-full justify-center">
        {ISSUE_PROVIDERS.map((provider) => (
          <ProviderLogo key={provider} provider={provider} className="size-4 opacity-50" />
        ))}
      </div>
      <p className="text-muted-foreground font-nomral text-sm text-center">
        Connect with one of our issue integrations to link your issues to your tasks.
      </p>
      <Button
        variant="link"
        size="xs"
        className="w-fit"
        onClick={() => navigate('settings', { tab: 'integrations' })}
      >
        Configure integrations
      </Button>
    </div>
  );
}
