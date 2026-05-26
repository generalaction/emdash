import { Check, Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ISSUE_PROVIDER_META,
  ISSUE_PROVIDER_ORDER,
} from '@renderer/features/integrations/issue-provider-meta';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@renderer/lib/ui/input-group';
import { Kbd } from '@renderer/lib/ui/kbd';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@renderer/lib/ui/select';
import { cn } from '@renderer/utils/utils';
import type { Issue } from '@shared/tasks';
import { IssueRow, ProviderLogo } from './issue-selector';
import { getLinkedIssueMap } from './use-linked-issue-urls';
import { useIssueSearch, type UseIssueSearchResult } from './useIssueSearch';

export interface InlineIssueSelectorProps {
  value: Issue | null;
  onValueChange: (issue: Issue | null) => void;
  projectId?: string;
  repositoryUrl?: string;
  projectPath?: string;
  disabled?: boolean;
  /** Skip "already linked" indicator for this task — useful when re-selecting the same task's issue. */
  excludeTaskId?: string;
  /** Provide pre-created search state to share with a parent (e.g. for a provider selector in the trigger). */
  issueSearchResult?: UseIssueSearchResult;
}

export const InlineIssueSelector = observer(function InlineIssueSelector({
  value,
  onValueChange,
  projectId,
  repositoryUrl = '',
  projectPath = '',
  disabled,
  excludeTaskId,
  issueSearchResult,
}: InlineIssueSelectorProps) {
  const linkedIssueMap = getLinkedIssueMap(projectId, excludeTaskId);
  const ownSearch = useIssueSearch(repositoryUrl, projectPath, projectId);
  const {
    issues,
    issueProvider,
    isProviderLoading,
    isProviderDisabled,
    connectedProviderCount,
    handleSetSearchTerm,
    setSelectedIssueProvider,
  } = issueSearchResult ?? ownSearch;

  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll highlighted item into view whenever it changes
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[highlightedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  const handleQueryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setQuery(val);
      handleSetSearchTerm(val);
      setHighlightedIndex(0);
    },
    [handleSetSearchTerm]
  );

  const handleProviderChange = useCallback(
    (provider: Issue['provider']) => {
      setSelectedIssueProvider(provider);
      if (value?.provider !== provider) {
        onValueChange(null);
      }
      setHighlightedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [setSelectedIssueProvider, value, onValueChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (issues.length === 0) return;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlightedIndex((prev) => Math.min(prev + 1, issues.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter': {
          e.preventDefault();
          const issue = issues[highlightedIndex];
          if (!issue) break;
          onValueChange(issue === value ? null : issue);
          break;
        }
        case 'Escape':
          e.preventDefault();
          if (query) {
            setQuery('');
            handleSetSearchTerm('');
            setHighlightedIndex(0);
          }
          break;
      }
    },
    [issues, highlightedIndex, value, query, onValueChange, handleSetSearchTerm]
  );

  const providerAddon = issueProvider ? (
    isProviderLoading ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground/60" />
    ) : connectedProviderCount > 1 ? (
      <Select
        value={issueProvider}
        onValueChange={(v) => v && handleProviderChange(v as Issue['provider'])}
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
    <div
      className={cn(
        'flex flex-col min-w-0 rounded-md overflow-hidden w-full',
        disabled && 'pointer-events-none'
      )}
    >
      <InputGroup className="border-input has-[[data-slot=input-group-control]:focus-visible]:border-input rounded-none border-0 border-b shadow-none has-[[data-slot=input-group-control]:focus-visible]:ring-0">
        {providerAddon && <InputGroupAddon align="inline-start">{providerAddon}</InputGroupAddon>}
        <InputGroupInput
          ref={inputRef}
          value={query}
          onChange={handleQueryChange}
          onKeyDown={handleKeyDown}
          placeholder={`Search ${issueProvider ?? 'issues'}…`}
          autoFocus
        />
      </InputGroup>
      <div ref={listRef} className="h-52 overflow-x-hidden overflow-y-auto p-1">
        {issues.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-foreground-passive">
            {query ? 'No issues found' : `No ${issueProvider} issues to show`}
          </div>
        ) : (
          issues.map((issue, index) => {
            const isSelected = value?.identifier === issue.identifier;
            const isHighlighted = index === highlightedIndex;
            const linkedTo = linkedIssueMap.get(issue.url);
            return (
              <button
                key={issue.identifier}
                type="button"
                className={cn(
                  'relative flex min-w-0 w-full cursor-default items-center gap-2 rounded-md py-1.5 px-2 text-sm outline-none select-none',
                  isHighlighted && !isSelected && 'bg-background-2',
                  isSelected && 'bg-background-2'
                )}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => onValueChange(isSelected ? null : issue)}
              >
                <IssueRow issue={issue} linkedTo={linkedTo} />
              </button>
            );
          })
        )}
      </div>
      <div className="flex h-6 items-center justify-between border-t border-border bg-background-1 px-2 text-xs">
        <div className="text-foreground-muted">Navigate with arrow keys</div>
        <div className="text-foreground-muted">
          <button className="flex items-center gap-2">
            Select Issue <Kbd>⏎</Kbd>
          </button>{' '}
        </div>
      </div>
    </div>
  );
});
