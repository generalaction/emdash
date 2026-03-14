import { useCallback, useMemo, useState } from 'react';
import githubLogo from '@/assets/images/github.png';
import jiraLogo from '@/assets/images/jira.png';
import linearLogo from '@/assets/images/Linear.svg';
import type { Issue } from '@shared/tasks';
import { useWorkspaceNavigation } from '@renderer/contexts/WorkspaceNavigationContext';
import { useGitHubIssues } from '@renderer/hooks/use-github-issues';
import { useJiraIssues } from '@renderer/hooks/use-jira-issues';
import { useLinearIssues } from '@renderer/hooks/use-linear-issues';
import { cn } from '@renderer/lib/utils';
import { useIntegrationStatus } from './hooks/useIntegrationStatus';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

function getStatusColor(status?: string): string | undefined {
  if (!status) return undefined;
  const s = status.toLowerCase();
  if (
    s.includes('done') ||
    s.includes('closed') ||
    s.includes('resolved') ||
    s.includes('completed')
  )
    return '#22c55e';
  if (s.includes('progress') || s.includes('review') || s.includes('open')) return '#3b82f6';
  if (s.includes('blocked') || s.includes('cancelled') || s.includes('canceled')) return '#ef4444';
  return '#6b7280';
}

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

function StatusPill({ status }: { status?: string }) {
  if (!status) return null;
  const color = getStatusColor(status);
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
      {color && (
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      {status}
    </span>
  );
}

function IdentifierBadge({
  provider,
  identifier,
}: {
  provider: Issue['provider'];
  identifier: string;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-border bg-muted px-1.5 py-0.5 dark:border-border dark:bg-card">
      <ProviderLogo provider={provider} className="h-3.5 w-3.5" />
      <span className="text-[11px] font-medium text-foreground">{identifier}</span>
    </span>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <IdentifierBadge provider={issue.provider} identifier={issue.identifier} />
      <StatusPill status={issue.status} />
      {issue.title ? <span className="truncate text-muted-foreground">{issue.title}</span> : null}
    </span>
  );
}

const ISSUE_PROVIDERS = ['linear', 'github', 'jira'] as const;

export interface IssueSelectorProps {
  value: Issue | null;
  onValueChange: (issue: Issue | null) => void;
  projectPath: string;
}

export function IssueSelector({ projectPath, value, onValueChange }: IssueSelectorProps) {
  const { navigate } = useWorkspaceNavigation();
  const { isLinearConnected, isGithubConnected, isJiraConnected } = useIntegrationStatus();
  const [selectedIssueProvider, setSelectedIssueProvider] = useState<Issue['provider'] | null>(
    null
  );

  const linearIssues = useLinearIssues({ enabled: isLinearConnected === true });
  const githubIssues = useGitHubIssues({
    projectPath,
    enabled: isGithubConnected && !!projectPath,
  });
  const jiraIssues = useJiraIssues({ enabled: isJiraConnected === true });

  const hasAnyIntegration = isLinearConnected || isGithubConnected || isJiraConnected;

  const issueProvider = useMemo(() => {
    if (!selectedIssueProvider) {
      if (isLinearConnected) return 'linear';
      if (isGithubConnected) return 'github';
      if (isJiraConnected) return 'jira';
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

  return (
    <div className="min-w-0 max-w-full overflow-hidden">
      {hasAnyIntegration ? (
        <>
          <Select
            value={issueProvider}
            onValueChange={(v) => setSelectedIssueProvider(v as Issue['provider'])}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select an issue provider" />
            </SelectTrigger>
            <SelectContent>
              {ISSUE_PROVIDERS.map((provider) => (
                <SelectItem key={provider} value={provider} disabled={isProviderDisabled(provider)}>
                  <ProviderLogo provider={provider} className="h-3.5 w-3.5" />
                  <span className="text-[11px] font-medium text-foreground">{provider}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

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
          >
            <ComboboxTrigger
              render={
                <button
                  className={cn(
                    'border w-full flex border-border h-18 hover:bg-muted/30 rounded-md px-2.5 py-1 text-left text-sm outline-none items-center justify-center',
                    !value && 'border-dashed'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <ComboboxValue
                      placeholder={
                        <div className="text-muted-foreground text-md text-center flex items-center gap-1">
                          Select a{' '}
                          <span className="flex items-center gap-1">
                            <ProviderLogo provider={issueProvider!} className="h-3.5 w-3.5" />
                            <span className="capitalize">{issueProvider}</span>
                          </span>{' '}
                          issue
                        </div>
                      }
                    >
                      {value ? <SelectedIssueValue issue={value!} /> : null}
                    </ComboboxValue>
                  </div>
                </button>
              }
            />
            <ComboboxContent className="min-w-(--anchor-width) pb-1">
              <ComboboxInput
                showClear={!!value}
                showTrigger={false}
                placeholder={`Search by ${issueProvider} issue key`}
                disabled={!hasAnyIntegration}
              />
              <ComboboxEmpty>
                <span className="text-muted-foreground">No issues found</span>
              </ComboboxEmpty>
              <ComboboxList>
                {(issue: Issue) => (
                  <ComboboxItem key={issue.identifier} value={issue}>
                    <IssueRow issue={issue} />
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </>
      ) : (
        <div>
          <p>Connect with one of the following integrations to search for issues:</p>
          <div>
            {ISSUE_PROVIDERS.map((provider) => (
              <button
                key={provider}
                onClick={() => setSelectedIssueProvider(provider)}
                className="flex items-center gap-2"
              >
                <ProviderLogo provider={provider} className="h-3.5 w-3.5" />
                <span className="text-[11px] font-medium text-foreground">{provider}</span>
              </button>
            ))}
          </div>
          <button onClick={() => navigate('settings')}>Configure integrations</button>
        </div>
      )}
    </div>
  );
}

function SelectedIssueValue({ issue }: { issue: Issue }) {
  return (
    <div>
      <div className="flex items-center gap-1">
        <ProviderLogo provider={issue.provider} className="h-3.5 w-3.5" />
        <span className="capitalize">{issue.provider + ' issue'}</span>
        <span className="text-muted-foreground">{issue.identifier}</span>
      </div>
      <StatusPill status={issue.status} />
      {issue.title ? <span className="truncate text-muted-foreground">{issue.title}</span> : null}
    </div>
  );
}
