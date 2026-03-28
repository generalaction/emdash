import { Check, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Issue } from '@shared/tasks';
import { cn } from '@renderer/lib/utils';
import { useIssueSearch } from './hooks/useIssueSearch';
import {
  ConnectIssueIntegrationPlaceholder,
  ISSUE_PROVIDERS,
  IssueRow,
  ProviderLogo,
} from './issue-selector';
import { InputGroup, InputGroupAddon, InputGroupInput } from './ui/input-group';
import { Select, SelectContent, SelectItem, SelectTrigger } from './ui/select';
import ShortcutHint from './ui/shortcut-hint';

export interface InlineIssueSelectorProps {
  value: Issue | null;
  onValueChange: (issue: Issue | null) => void;
  nameWithOwner?: string;
  disabled?: boolean;
}

export function InlineIssueSelector({
  value,
  onValueChange,
  nameWithOwner = '',
  disabled,
}: InlineIssueSelectorProps) {
  const {
    issues,
    issueProvider,
    hasAnyIntegration,
    isProviderLoading,
    isProviderDisabled,
    connectedProviderCount,
    handleSetSearchTerm,
    setSelectedIssueProvider,
  } = useIssueSearch(nameWithOwner);

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
          if (issue) onValueChange(issue === value ? null : issue);
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
          <div className="py-6 text-center text-sm text-muted-foreground">
            {query ? 'No issues found' : `No ${issueProvider ?? 'issues'} to show`}
          </div>
        ) : (
          issues.map((issue, index) => {
            const isSelected = value?.identifier === issue.identifier;
            const isHighlighted = index === highlightedIndex;
            return (
              <button
                key={issue.identifier}
                type="button"
                className={cn(
                  'relative flex min-w-0 w-full cursor-default items-center gap-2 rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none select-none',
                  isHighlighted && !isSelected && 'bg-background-2',
                  isSelected && 'bg-background-2'
                )}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => onValueChange(isSelected ? null : issue)}
              >
                <IssueRow issue={issue} />
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
}
