import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Search } from 'lucide-react';
import githubLogo from '../../assets/images/github.png';
import { Separator } from './ui/separator';
import { Badge } from './ui/badge';
import { Spinner } from './ui/spinner';
import { type GitHubIssueSummary } from '../types/github';

interface GitHubIssueSelectorProps {
  projectPath: string;
  selectedIssue: GitHubIssueSummary | null;
  onIssueChange: (issue: GitHubIssueSummary | null) => void;
  isOpen?: boolean;
  className?: string;
  disabled?: boolean;
}

export const GitHubIssueSelector: React.FC<GitHubIssueSelectorProps> = ({
  projectPath,
  selectedIssue,
  onIssueChange,
  isOpen = false,
  className = '',
  disabled = false,
}) => {
  const [availableIssues, setAvailableIssues] = useState<GitHubIssueSummary[]>([]);
  const [isLoadingIssues, setIsLoadingIssues] = useState(false);
  const [issueListError, setIssueListError] = useState<string | null>(null);
  const [hasRequestedIssues, setHasRequestedIssues] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<GitHubIssueSummary[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [visibleCount, setVisibleCount] = useState(10);
  const isMountedRef = useRef(true);

  const api = (typeof window !== 'undefined' ? (window as any).electronAPI : null) as any;
  const canListGithub = !!api?.githubIssuesList && !!projectPath;
  const issuesLoaded = availableIssues.length > 0;

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

  const loadIssues = useCallback(async () => {
    if (!canListGithub) return;
    setIsLoadingIssues(true);
    try {
      const result = await api.githubIssuesList(projectPath, 50);
      if (!isMountedRef.current) return;
      if (!result?.success) throw new Error(result?.error || 'Failed to load GitHub issues.');
      setAvailableIssues(result.issues ?? []);
      setIssueListError(null);
    } catch (error) {
      if (!isMountedRef.current) return;
      setAvailableIssues([]);
      setIssueListError(error instanceof Error ? error.message : 'Failed to load GitHub issues.');
    } finally {
      if (!isMountedRef.current) return;
      setIsLoadingIssues(false);
      setHasRequestedIssues(true);
    }
  }, [api, canListGithub, projectPath]);

  useEffect(() => {
    if (!isOpen || !canListGithub || disabled) return;
    if (isLoadingIssues || hasRequestedIssues) return;
    loadIssues();
  }, [isOpen, canListGithub, isLoadingIssues, hasRequestedIssues, loadIssues, disabled]);

  const searchIssues = useCallback(
    async (term: string) => {
      if (!term.trim()) {
        setSearchResults([]);
        setIsSearching(false);
        return;
      }
      if (!api?.githubIssuesSearch) return;
      setIsSearching(true);
      try {
        const result = await api.githubIssuesSearch(projectPath, term.trim(), 20);
        if (!isMountedRef.current) return;
        if (result?.success) setSearchResults(result.issues ?? []);
        else setSearchResults([]);
      } catch {
        if (!isMountedRef.current) return;
        setSearchResults([]);
      } finally {
        if (!isMountedRef.current) return;
        setIsSearching(false);
      }
    },
    [api, projectPath]
  );

  useEffect(() => {
    const id = setTimeout(() => searchIssues(searchTerm), 300);
    return () => clearTimeout(id);
  }, [searchTerm, searchIssues]);

  const displayIssues = useMemo(() => {
    if (searchTerm.trim()) return searchResults;
    return availableIssues;
  }, [searchResults, availableIssues, searchTerm]);

  useEffect(() => setVisibleCount(10), [searchTerm]);

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

  const handleIssueSelect = (value: string) => {
    const num = Number(String(value).replace(/^#/, ''));
    const issue = displayIssues.find((i) => i.number === num) ?? null;
    onIssueChange(issue);
  };

  const issueHelperText = (() => {
    if (!canListGithub) return 'Connect GitHub CLI to browse issues.';
    if (hasRequestedIssues && !isLoadingIssues && !issuesLoaded && !issueListError)
      return 'No GitHub issues available for this project.';
    return null;
  })();

  const issuePlaceholder = isLoadingIssues
    ? 'Loading…'
    : issueListError
      ? 'Connect your GitHub'
      : 'Select a GitHub issue';

  if (!canListGithub) {
    return (
      <div className={className}>
        <Input value="" placeholder="GitHub integration unavailable" disabled />
        <p className="mt-2 text-xs text-muted-foreground">
          Connect GitHub CLI in Settings to browse issues.
        </p>
      </div>
    );
  }

  return (
    <div className={className}>
      <Select
        value={selectedIssue ? `#${selectedIssue.number}` : undefined}
        onValueChange={handleIssueSelect}
        disabled={disabled || isLoadingIssues || !!issueListError || !issuesLoaded}
      >
        <SelectTrigger className="h-9 w-full border-none bg-gray-100 dark:bg-gray-700">
          <SelectValue placeholder={issuePlaceholder} />
        </SelectTrigger>
        <SelectContent side="top" className="z-[120]">
          <div className="relative px-3 py-2">
            <Search className="absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by title or assignee…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-7 w-full border-none bg-transparent pl-9 pr-3 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
          <Separator />
          <div className="max-h-80 overflow-y-auto" onScroll={handleScroll}>
            {showIssues.length > 0 ? (
              showIssues.map((issue) => (
                <SelectItem key={issue.number} value={`#${issue.number}`}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 dark:border-gray-700 dark:bg-gray-800">
                      <img src={githubLogo} alt="GitHub" className="h-3.5 w-3.5" />
                      <span className="text-[11px] font-medium text-foreground">
                        #{issue.number}
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
              <img src={githubLogo} alt="GitHub" className="h-3.5 w-3.5" />
              <span>Connect GitHub</span>
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Sign in with GitHub CLI in Settings to browse and attach issues here.
          </p>
        </div>
      ) : null}
      {issueHelperText ? (
        <p className="mt-2 text-xs text-muted-foreground">{issueHelperText}</p>
      ) : null}
    </div>
  );
};

export default GitHubIssueSelector;
