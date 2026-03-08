import { Search } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import jiraLogo from '../../assets/images/jira.png';
import { useIntegrationsContext } from '../contexts/IntegrationsProvider';
import { rpc } from '../lib/ipc';
import { type JiraIssueSummary } from '../types/jira';
import { JiraIssuePreviewTooltip } from './JiraIssuePreviewTooltip';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger } from './ui/select';
import { Separator } from './ui/separator';
import { Spinner } from './ui/spinner';

interface Props {
  selectedIssue: JiraIssueSummary | null;
  onIssueChange: (issue: JiraIssueSummary | null) => void;
  isOpen?: boolean;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}

const JiraIssueSelector: React.FC<Props> = ({
  selectedIssue,
  onIssueChange,
  isOpen = false,
  className = '',
  disabled = false,
  placeholder: customPlaceholder,
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

  const { isJiraConnected } = useIntegrationsContext();
  const canList = typeof window !== 'undefined';
  const issuesLoaded = availableIssues.length > 0;
  // Only disable when explicitly disabled, or when not connected and we can't load
  const isDisabled =
    disabled ||
    (isJiraConnected === false ? isLoadingIssues || !!issueListError || !issuesLoaded : false);

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

  const loadIssues = useCallback(async () => {
    if (!canList) return;
    setIsLoadingIssues(true);
    try {
      const result = await rpc.jira.initialFetch(50);
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
    if (!isOpen || !canList || isLoadingIssues || hasRequestedIssues) return;
    loadIssues();
  }, [isOpen, canList, isLoadingIssues, hasRequestedIssues, loadIssues]);

  const searchIssues = useCallback(async (term: string) => {
    if (!term.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    try {
      const result = await rpc.jira.searchIssues(term.trim(), 20);
      if (!isMountedRef.current) return;
      setSearchResults(result?.success ? (result.issues ?? []) : []);
      if (result?.success) {
        // Track search
        void (async () => {
          const { captureTelemetry } = await import('../lib/telemetryClient');
          captureTelemetry('jira_issues_searched');
        })();
      }
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
      setVisibleCount((c) =>
        Math.min(c + 10, (searchTerm.trim() ? searchResults : availableIssues).length)
      );
    }
  };

  const handleIssueSelect = (key: string) => {
    if (key === '__clear__') {
      onIssueChange(null);
      return;
    }
    const all = searchTerm.trim() ? searchResults : availableIssues;
    const issue = all.find((i) => i.key === key) || null;
    if (issue) {
      void (async () => {
        const { captureTelemetry } = await import('../lib/telemetryClient');
        captureTelemetry('jira_issue_selected');
      })();
    }
    onIssueChange(issue);
  };

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

  const issuePlaceholder =
    customPlaceholder ??
    (isLoadingIssues ? 'Loading…' : issueListError ? 'Connect your Jira' : 'Select a Jira issue');

  return (
    <div className={`min-w-0 max-w-full overflow-hidden ${className}`} style={{ maxWidth: '100%' }}>
      <Select
        value={selectedIssue?.key || '__clear__'}
        onValueChange={handleIssueSelect}
        disabled={isDisabled}
      >
        <SelectTrigger
          className="h-9 w-full overflow-hidden border-none bg-muted"
          style={{ maxWidth: '100%' }}
        >
          <div className="flex w-full items-center gap-2 overflow-hidden text-left text-foreground">
            {selectedIssue ? (
              <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                <JiraIssuePreviewTooltip issue={selectedIssue}>
                  <span
                    className="inline-flex items-center gap-1.5 rounded border border-border bg-muted px-1.5 py-0.5 dark:border-border dark:bg-card"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <img src={jiraLogo} alt="Jira" className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-medium text-foreground">
                      {selectedIssue.key}
                    </span>
                  </span>
                </JiraIssuePreviewTooltip>
                {selectedIssue.summary ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                    <span className="text-foreground">-</span>
                    <span className="truncate text-muted-foreground">{selectedIssue.summary}</span>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <img src={jiraLogo} alt="Jira" className="h-3.5 w-3.5" />
                {isLoadingIssues ? (
                  <>
                    <span className="truncate text-muted-foreground">Loading Jira issues</span>
                    <Spinner size="sm" />
                  </>
                ) : (
                  <span className="truncate text-muted-foreground">{issuePlaceholder}</span>
                )}
              </>
            )}
          </div>
        </SelectTrigger>
        <SelectContent side="top" className="z-[120] w-full max-w-[480px]">
          <div className="relative px-3 py-2">
            <Search className="absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by key"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              disabled={disabled}
              className="h-7 w-full border-none bg-transparent pl-9 pr-3 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
          <Separator />
          <div className="max-h-80 overflow-y-auto overflow-x-hidden py-1" onScroll={handleScroll}>
            <SelectItem value="__clear__">
              <span className="text-sm text-muted-foreground">None</span>
            </SelectItem>
            <Separator className="my-1" />
            {showIssues.length > 0 ? (
              showIssues.map((issue) => (
                <JiraIssuePreviewTooltip key={issue.id || issue.key} issue={issue} side="left">
                  <SelectItem value={issue.key}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-border bg-muted px-1.5 py-0.5 dark:border-border dark:bg-card">
                        <img src={jiraLogo} alt="Jira" className="h-3.5 w-3.5" />
                        <span className="text-[11px] font-medium text-foreground">{issue.key}</span>
                      </span>
                      {issue.summary ? (
                        <span className="truncate text-foreground">{issue.summary}</span>
                      ) : null}
                    </span>
                  </SelectItem>
                </JiraIssuePreviewTooltip>
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
    </div>
  );
};

export default JiraIssueSelector;
