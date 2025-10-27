import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger } from './ui/select';
import { Search } from 'lucide-react';
import jiraLogo from '../../assets/images/jira.png';
import { type JiraIssueSummary } from '../types/jira';
import { Separator } from './ui/separator';
import { Badge } from './ui/badge';
import { Spinner } from './ui/spinner';

interface Props {
  selectedIssue: JiraIssueSummary | null;
  onIssueChange: (issue: JiraIssueSummary | null) => void;
  isOpen?: boolean;
  className?: string;
}

const JiraIssueSelector: React.FC<Props> = ({
  selectedIssue,
  onIssueChange,
  isOpen = false,
  className = '',
}) => {
  const [availableIssues, setAvailableIssues] = useState<JiraIssueSummary[]>([]);
  const [isLoadingIssues, setIsLoadingIssues] = useState(false);
  const [issueListError, setIssueListError] = useState<string | null>(null);
  const [hasRequestedIssues, setHasRequestedIssues] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<JiraIssueSummary[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const isMountedRef = useRef(true);
  const [visibleCount, setVisibleCount] = useState(10);

  const canList = typeof window !== 'undefined' && !!window.electronAPI?.jiraInitialFetch;
  const issuesLoaded = availableIssues.length > 0;
  const [isConnected, setIsConnected] = useState<boolean | null>(null);

  useEffect(() => () => void (isMountedRef.current = false), []);

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

  // Check connection so we can show better guidance when listing fails
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const api: any = (window as any).electronAPI;
        const res = await api?.jiraCheckConnection?.();
        if (!cancel) setIsConnected(!!res?.connected);
      } catch {
        if (!cancel) setIsConnected(null);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const loadIssues = useCallback(async () => {
    if (!canList) return;
    const api = window.electronAPI;
    if (!api?.jiraInitialFetch) {
      setAvailableIssues([]);
      setIssueListError('Jira issue list unavailable in this build.');
      setHasRequestedIssues(true);
      return;
    }
    setIsLoadingIssues(true);
    try {
      const result = await api.jiraInitialFetch(50);
      if (!isMountedRef.current) return;
      if (!result?.success) throw new Error(result?.error || 'Failed to load Jira issues.');
      setAvailableIssues(result.issues ?? []);
      setIssueListError(null);
    } catch (error) {
      if (!isMountedRef.current) return;
      setAvailableIssues([]);
      setIssueListError(error instanceof Error ? error.message : 'Failed to load Jira issues.');
    } finally {
      if (!isMountedRef.current) return;
      setIsLoadingIssues(false);
      setHasRequestedIssues(true);
    }
  }, [canList]);

  useEffect(() => {
    if (!isOpen || !canList) return;
    if (isLoadingIssues || hasRequestedIssues) return;
    loadIssues();
  }, [isOpen, canList, isLoadingIssues, hasRequestedIssues, loadIssues]);

  const searchIssues = useCallback(async (term: string) => {
    if (!term.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    const api = window.electronAPI;
    if (!api?.jiraSearchIssues) return;
    setIsSearching(true);
    try {
      const result = await api.jiraSearchIssues(term.trim(), 20);
      if (!isMountedRef.current) return;
      setSearchResults(result?.success ? result.issues ?? [] : []);
    } catch {
      if (isMountedRef.current) setSearchResults([]);
    } finally {
      if (isMountedRef.current) setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void searchIssues(searchTerm), 250);
    return () => clearTimeout(t);
  }, [searchTerm, searchIssues]);

  const showIssues = useMemo(() => {
    const source = searchTerm.trim() ? searchResults : availableIssues;
    return source.slice(0, visibleCount);
  }, [availableIssues, searchResults, searchTerm, visibleCount]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 16) {
      setVisibleCount((c) => Math.min(c + 10, (searchTerm.trim() ? searchResults : availableIssues).length));
    }
  };

  const handleIssueSelect = (key: string) => {
    const all = searchTerm.trim() ? searchResults : availableIssues;
    const issue = all.find((i) => i.key === key) || null;
    onIssueChange(issue);
  };

  const helperText = (() => {
    if (!canList) return 'Connect Jira in Settings to browse issues.';
    if (issueListError) {
      if (isConnected) {
        return 'Connected to Jira, but listing issues failed. Try searching by key (e.g., ABC-123) or adjust project permissions (need Browse projects).';
      }
      return issueListError;
    }
    if (isLoadingIssues) return 'Loading…';
    if (hasRequestedIssues && !issuesLoaded && !issueListError) return 'No Jira issues available.';
    return null;
  })();

  if (!canList) {
    return (
      <div className={className}>
        <Input value="" placeholder="Jira integration unavailable" disabled />
        <p className="mt-2 text-xs text-muted-foreground">
          Connect Jira in Settings to browse issues.
        </p>
      </div>
    );
  }

  const issuePlaceholder = isLoadingIssues
    ? 'Loading…'
    : issueListError
      ? 'Connect your Jira'
      : 'Select a Jira issue';

  return (
    <div className={className}>
      <Select
        value={selectedIssue?.key || undefined}
        onValueChange={handleIssueSelect}
        disabled={!isConnected ? isLoadingIssues || !!issueListError || !issuesLoaded : false}
      >
        <SelectTrigger className="h-9 w-full border-none bg-gray-100 dark:bg-gray-700">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left text-foreground">
            {selectedIssue ? (
              <>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 dark:border-gray-700 dark:bg-gray-800">
                  <img src={jiraLogo} alt="Jira" className="h-3.5 w-3.5" />
                  <span className="text-[11px] font-medium text-foreground">{selectedIssue.key}</span>
                </span>
                {selectedIssue.summary ? (
                  <>
                    <span className="shrink-0 text-foreground">-</span>
                    <span className="truncate">{selectedIssue.summary}</span>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <img src={jiraLogo} alt="Jira" className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{issuePlaceholder}</span>
              </>
            )}
          </div>
        </SelectTrigger>
        <SelectContent side="top">
          <div className="relative px-3 py-2">
            <Search className="absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by key, summary, or assignee…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-7 w-full border-none bg-transparent pl-9 pr-3 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
          <Separator />
          <div className="max-h-80 overflow-y-auto" onScroll={handleScroll}>
            {showIssues.length > 0 ? (
              showIssues.map((issue) => (
                <SelectItem key={issue.id || issue.key} value={issue.key}>
                  <SelectItemText>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 dark:border-gray-700 dark:bg-gray-800">
                        <img src={jiraLogo} alt="Jira" className="h-3.5 w-3.5" />
                        <span className="text-[11px] font-medium text-foreground">{issue.key}</span>
                      </span>
                      {issue.summary ? (
                        <span className="truncate text-foreground">{issue.summary}</span>
                      ) : null}
                    </span>
                  </SelectItemText>
                </SelectItem>
              ))
            ) : searchTerm.trim() ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                {isSearching ? (
                  <div className="flex items-center gap-2">
                    <Spinner size="sm" />
                    <span>Searching…</span>
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
      {helperText && issueListError ? (
        <div className="mt-2 rounded-md border border-border bg-muted/40 p-2">
          <div className="flex items-center gap-2">
            <Badge className="inline-flex items-center gap-1.5">
              <img src={jiraLogo} alt="Jira" className="h-3.5 w-3.5" />
              <span>{isConnected ? 'Jira connected' : 'Connect Jira'}</span>
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {isConnected
              ? 'Unable to list issues; search by key or update project permissions to include “Browse projects”.'
              : 'Add your Jira site, email, and API token in Settings → Integrations to browse and attach issues here.'}
          </p>
        </div>
      ) : null}
    </div>
  );
};

export default JiraIssueSelector;
