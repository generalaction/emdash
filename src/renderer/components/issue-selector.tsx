import { Combobox as ComboboxPrimitive } from '@base-ui/react';
import type { Issue } from '@shared/tasks';
import githubLogo from '../../assets/images/github.png';
import jiraLogo from '../../assets/images/jira.png';
import linearLogoSvg from '../../assets/images/Linear.svg?raw';
import type { UseIssuesResult } from '../hooks/use-linear-issues';
import AgentLogo from './AgentLogo';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from './ui/combobox';
import { Spinner } from './ui/spinner';

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
  if (provider === 'linear') {
    return <AgentLogo logo={linearLogoSvg} alt="Linear" className={className ?? 'h-3.5 w-3.5'} />;
  }
  if (provider === 'github') {
    return <img src={githubLogo} alt="GitHub" className={className ?? 'h-3.5 w-3.5'} />;
  }
  return <img src={jiraLogo} alt="Jira" className={className ?? 'h-3.5 w-3.5'} />;
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

export interface IssueSelectorProps extends UseIssuesResult {
  value: Issue | null;
  onValueChange: (issue: Issue | null) => void;
  provider: Issue['provider'];
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function IssueSelector({
  issues,
  isLoading,
  error,
  searchTerm,
  setSearchTerm,
  isSearching,
  value,
  onValueChange,
  provider,
  disabled = false,
  placeholder,
  className,
}: IssueSelectorProps) {
  const defaultPlaceholder = isLoading
    ? 'Loading…'
    : error
      ? `Connect your ${provider === 'linear' ? 'Linear' : provider === 'github' ? 'GitHub' : 'Jira'}`
      : `Select a ${provider === 'linear' ? 'Linear' : provider === 'github' ? 'GitHub' : 'Jira'} issue`;

  const resolvedPlaceholder = placeholder ?? defaultPlaceholder;

  return (
    <div className={`min-w-0 max-w-full overflow-hidden ${className ?? ''}`}>
      <Combobox
        items={issues}
        filter={null}
        itemToStringLabel={(issue: Issue | null) =>
          issue ? `${issue.identifier} ${issue.title}` : ''
        }
        value={value}
        onValueChange={(next: Issue | null) => onValueChange(next)}
        onInputValueChange={(val: string, { reason }: { reason: string }) => {
          if (reason !== 'item-press') setSearchTerm(val);
        }}
        onOpenChangeComplete={(open: boolean) => {
          if (!open) setSearchTerm('');
        }}
        disabled={disabled}
      >
        <ComboboxInput
          showClear={!!value}
          showTrigger={!value}
          placeholder={resolvedPlaceholder}
          disabled={disabled}
          className="h-9 w-full border-none bg-muted"
        />
        <ComboboxContent side="top">
          <ComboboxPrimitive.Status className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
            {isLoading || isSearching ? (
              <span className="flex items-center gap-2">
                <Spinner size="sm" />
                <span>{isLoading ? 'Loading issues…' : 'Searching…'}</span>
              </span>
            ) : error ? (
              <span className="text-destructive">{error}</span>
            ) : null}
          </ComboboxPrimitive.Status>
          <ComboboxEmpty>
            {isLoading || isSearching
              ? null
              : searchTerm.trim()
                ? `No issues found for "${searchTerm}"`
                : 'No issues available'}
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
    </div>
  );
}

export default IssueSelector;
