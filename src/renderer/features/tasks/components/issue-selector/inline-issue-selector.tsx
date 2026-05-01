import { Check, Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Issue } from '@shared/tasks';
import {
  ISSUE_PROVIDER_META,
  ISSUE_PROVIDER_ORDER,
} from '@renderer/features/integrations/issue-provider-meta';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@renderer/lib/ui/input-group';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@renderer/lib/ui/select';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { cn } from '@renderer/utils/utils';
import { ConnectIssueIntegrationPlaceholder, IssueRow, ProviderLogo } from './issue-selector';
import { getLinkedIssueMap } from './use-linked-issue-urls';
import { useIssueSearch } from './useIssueSearch';

export interface InlineIssueSelectorProps {
  value: Issue | null;
  onValueChange: (issue: Issue | null) => void;
  projectId?: string;
  repositoryUrl?: string;
  projectPath?: string;
  disabled?: boolean;
  /** Skip "already linked" indicator for this task — useful when re-selecting the same task's issue. */
  excludeTaskId?: string;
}

export const InlineIssueSelector = observer(function InlineIssueSelector({
  value,
  onValueChange,
  projectId,
  repositoryUrl = '',
  projectPath = '',
  disabled,
  excludeTaskId,
}: InlineIssueSelectorProps) {
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

  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Hold the latest map in a ref so handleKeyDown stays referentially stable.
  // useMemo would break MobX reactivity here — observables wouldn't be re-read on cached renders.
  const linkedIssueMapRef = useRef(linkedIssueMap);
  linkedIssueMapRef.current = linkedIssueMap;

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
      const linked = linkedIssueMapRef.current;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlightedIndex((prev) => {
            for (let i = prev + 1; i < issues.length; i++) {
              if (!linked.has(issues[i].url)) return i;
            }
            return prev;
          });
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightedIndex((prev) => {
            for (let i = prev - 1; i >= 0; i--) {
              if (!linked.has(issues[i].url)) return i;
            }
            return prev;
          });
          break;
        case 'Enter': {
          e.preventDefault();
          const issue = issues[highlightedIndex];
          if (!issue) break;
          if (linked.has(issue.url)) break;
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

  if (!hasAnyIntegration) {
    return <ConnectIssueIntegrationPlaceholder />;
  }

  return (
    <div
      className={cn(
        'flex flex-col min-w-0 rounded-md border border-input overflow-hidden',
        disabled && 'pointer-events-none'
      )}
    >
      {/* Search row */}
      <InputGroup className="rounded-none border-0 border-b border-input shadow-none has-[[data-slot=input-group-control]:focus-visible]:ring-0 has-[[data-slot=input-group-control]:focus-visible]:border-input">
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

      {/* Issue list */}
      <div ref={listRef} className="overflow-y-auto overflow-x-hidden h-52 p-1">
        {issues.length === 0 ? (
          <div className="text-center text-sm text-foreground-passive flex items-center justify-center h-full">
            {query ? 'No issues found' : `No ${issueProvider} issues to show`}
          </div>
        ) : (
          issues.map((issue, index) => {
            const isSelected = value?.identifier === issue.identifier;
            const isHighlighted = index === highlightedIndex;
            const linkedTo = linkedIssueMap.get(issue.url);
            const isLinked = !!linkedTo;
            return (
              <button
                key={issue.identifier}
                type="button"
                disabled={isLinked}
                className={cn(
                  'relative flex min-w-0 w-full cursor-default items-center gap-2 rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none select-none',
                  isHighlighted && !isSelected && !isLinked && 'bg-background-2',
                  isSelected && 'bg-background-2',
                  isLinked && 'cursor-not-allowed opacity-50'
                )}
                onMouseEnter={() => {
                  if (!isLinked) setHighlightedIndex(index);
                }}
                onClick={() => {
                  if (isLinked) return;
                  onValueChange(isSelected ? null : issue);
                }}
              >
                <IssueRow issue={issue} linkedTo={linkedTo} />
                {isSelected && (
                  <Check className="absolute right-2 size-3.5 shrink-0 text-foreground-muted" />
                )}
              </button>
            );
          })
        )}
      </div>
      <div className="flex items-center justify-between h-6 px-2 text-xs bg-background-1 border-t border-border">
        <div className="text-foreground-muted">Navigate with arrow keys</div>
        <div className="text-foreground-muted">
          <button className="flex items-center gap-2">
            Select Issue <ShortcutHint settingsKey="confirm" />
          </button>{' '}
        </div>
      </div>
    </div>
  );
});
