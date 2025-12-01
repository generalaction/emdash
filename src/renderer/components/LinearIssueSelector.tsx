import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger } from './ui/select';
import { Search } from 'lucide-react';
import linearLogo from '../../assets/images/linear.png';
import { type LinearIssueSummary } from '../types/linear';
import { Separator } from './ui/separator';
import { Badge } from './ui/badge';
import { Spinner } from './ui/spinner';

interface LinearIssueSelectorProps {
  selectedIssue: LinearIssueSummary | null;
  onIssueChange: (issue: LinearIssueSummary | null) => void;
  isOpen?: boolean;
  className?: string;
  disabled?: boolean;
}

export const LinearIssueSelector: React.FC<LinearIssueSelectorProps> = ({
  selectedIssue,
  onIssueChange,
  isOpen = false,
  className = '',
  disabled = false,
}) => {
  const [availableIssues, setAvailableIssues] = useState<LinearIssueSummary[]>([]);
  const [isLoadingIssues, setIsLoadingIssues] = useState(false);
  const [issueListError, setIssueListError] = useState<string | null>(null);
  const [hasRequestedIssues, setHasRequestedIssues] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<LinearIssueSummary[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const isMountedRef = useRef(true);
  const [visibleCount, setVisibleCount] = useState(10);

  const canListLinear = typeof window !== 'undefined' && !!window.electronAPI?.linearInitialFetch;
  const issuesLoaded = availableIssues.length > 0;
  const isDisabled = disabled || isLoadingIssues || !!issueListError || !issuesLoaded;

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setAvailableIssues([]);
      setHasRequestedIssues(false);
      setIssueListError(null);
      setIsLoadingIssues(false);
      setSearchTerm('');
      setSearchResults([]);
      setIsSearching(false);
      onIssueChange(null);
      setVisibleCount(10);
    }
  }, [isOpen, onIssueChange]);

  const loadLinearIssues = useCallback(async () => {
    if (!canListLinear) {
      return;
    }

    const api = window.electronAPI;
    if (!api?.linearInitialFetch) {
      setAvailableIssues([]);
      setIssueListError('Linear issue list unavailable in this build.');
      setHasRequestedIssues(true);
      return;
    }

    setIsLoadingIssues(true);
    try {
      // Fetch a generous set from Linear; UI renders 10 initially
      const result = await api.linearInitialFetch(50);
      if (!isMountedRef.current) return;
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to load Linear issues.');
      }
      setAvailableIssues(result.issues ?? []);
      setIssueListError(null);
    } catch (error) {
      if (!isMountedRef.current) return;
      setAvailableIssues([]);
      setIssueListError(error instanceof Error ? error.message : 'Failed to load Linear issues.');
    } finally {
      if (!isMountedRef.current) return;
      setIsLoadingIssues(false);
      setHasRequestedIssues(true);
    }
  }, [canListLinear]);

  useEffect(() => {
    if (!isOpen || !canListLinear || disabled) {
      return;
    }
    if (isLoadingIssues || hasRequestedIssues) {
      return;
    }
    loadLinearIssues();
  }, [isOpen, canListLinear, isLoadingIssues, hasRequestedIssues, loadLinearIssues]);

  const searchIssues = useCallback(async (term: string) => {
    if (!term.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const api = window.electronAPI;
    if (!api?.linearSearchIssues) {
      return;
    }

    setIsSearching(true);
    try {
      const result = await api.linearSearchIssues(term.trim(), 20);
      if (!isMountedRef.current) return;
      if (result?.success) {
        setSearchResults(result.issues ?? []);
      } else {
        setSearchResults([]);
      }
    } catch (error) {
      if (!isMountedRef.current) return;
      setSearchResults([]);
    } finally {
      if (!isMountedRef.current) return;
      setIsSearching(false);
    }
  }, []);

  // Debounced search effect
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      searchIssues(searchTerm);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchTerm, searchIssues]);

  // Combine search results and available issues
  const displayIssues = useMemo(() => {
    if (searchTerm.trim()) {
      return searchResults;
    }
    return availableIssues;
  }, [searchTerm, searchResults, availableIssues]);

  // Reset how many are visible when the search term changes
  useEffect(() => {
    setVisibleCount(10);
  }, [searchTerm]);

  const showIssues = useMemo(
    () => displayIssues.slice(0, Math.max(10, visibleCount)),
    [displayIssues, visibleCount]
  );

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 16;
      if (nearBottom && showIssues.length < displayIssues.length) {
        setVisibleCount((prev) => Math.min(prev + 10, displayIssues.length));
      }
    },
    [displayIssues.length, showIssues.length]
  );

  const handleIssueSelect = (identifier: string) => {
    if (identifier === '__clear__') {
      onIssueChange(null);
      return;
    }
    const issue = displayIssues.find((issue) => issue.identifier === identifier) ?? null;
    onIssueChange(issue);
  };

  const issueHelperText = (() => {
    if (!canListLinear) {
      return 'Connect Linear in Settings to browse issues.';
    }
    if (hasRequestedIssues && !isLoadingIssues && !issuesLoaded && !issueListError) {
      return 'No Linear issues available.';
    }
    return null;
  })();

  const issuePlaceholder = isLoadingIssues
    ? 'Loading…'
    : issueListError
      ? 'Connect your Linear'
      : 'Select a Linear issue';

  if (!canListLinear) {
    return (
      <div className={className}>
        <Input value="" placeholder="Linear integration unavailable" disabled />
        <p className="mt-2 text-xs text-muted-foreground">
          Connect Linear in Settings to browse issues.
        </p>
      </div>
    );
  }

  return (
    <div className={className}>
      <Select
        value={selectedIssue?.identifier || undefined}
        onValueChange={handleIssueSelect}
        disabled={isDisabled}
      >
        <SelectTrigger className="h-9 w-full border-none bg-gray-100 dark:bg-gray-700">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left text-foreground">
            {selectedIssue ? (
              <>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 dark:border-gray-700 dark:bg-gray-800">
                  <img src={linearLogo} alt="Linear" className="h-3.5 w-3.5 dark:invert" />
                  <span className="text-[11px] font-medium text-foreground">
                    {selectedIssue.identifier}
                  </span>
                </span>
                {selectedIssue.title ? (
                  <>
                    <span className="shrink-0 text-foreground">-</span>
                    <span className="truncate text-muted-foreground">{selectedIssue.title}</span>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <img src={linearLogo} alt="Linear" className="h-3.5 w-3.5 shrink-0 dark:invert" />
                <span className="truncate text-muted-foreground">{issuePlaceholder}</span>
              </>
            )}
          </div>
        </SelectTrigger>
        <SelectContent side="top" className="z-[120]">
          <div className="relative px-3 py-2">
            <Search className="absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, ID, or assignee..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              disabled={disabled}
              className="h-7 w-full border-none bg-transparent pl-9 pr-3 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
        </div>
        <Separator />
        <div className="max-h-80 overflow-y-auto py-1" onScroll={handleScroll}>
          <SelectItem value="__clear__">
            <span className="text-sm text-muted-foreground">None</span>
          </SelectItem>
          <Separator className="my-1" />
          {showIssues.length > 0 ? (
            showIssues.map((issue) => (
              <SelectItem key={issue.id || issue.identifier} value={issue.identifier}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 dark:border-gray-700 dark:bg-gray-800">
                      <img src={linearLogo} alt="Linear" className="h-3.5 w-3.5 dark:invert" />
                      <span className="text-[11px] font-medium text-foreground">
                        {issue.identifier}
                      </span>
                    </span>
                    {issue.title ? (
                      <span className="ml-2 truncate text-muted-foreground">{issue.title}</span>
                    ) : null}
                  </span>
                </SelectItem>
              ))
            ) : searchTerm.trim() ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                {isSearching ? (
                  <div className="flex items-center gap-2">
                    <Spinner size="sm" />
                    <span>Searching</span>
                  </div>
                ) : (
                  `No issues found for "${searchTerm}"`
                )}
              </div>
            ) : (
              <div className="px-3 py-2 text-sm text-muted-foreground">No issues available</div>
            )}
          </div>
        </SelectContent>
      </Select>
      {issueListError ? (
        <div className="mt-2 rounded-md border border-border bg-muted/40 p-2">
          <div className="flex items-center gap-2">
            <Badge className="inline-flex items-center gap-1.5">
              <img src={linearLogo} alt="Linear" className="h-3.5 w-3.5 dark:invert" />
              <span>Connect Linear</span>
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Add your Linear API key in Settings → Integrations to browse and attach issues here.
          </p>
        </div>
      ) : null}
      {issueHelperText ? (
        <p className="mt-2 text-xs text-muted-foreground">{issueHelperText}</p>
      ) : null}
    </div>
  );
};

export default LinearIssueSelector;
