import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger } from './ui/select';
import { Search } from 'lucide-react';
import gitlabLogoSvg from '../../assets/images/GitLab.svg?raw';
import { type GitLabIssueSummary } from '../types/gitlab';
import { Separator } from './ui/separator';
import { Spinner } from './ui/spinner';
import { GitLabIssuePreviewTooltip } from './GitLabIssuePreviewTooltip';
import AgentLogo from './AgentLogo';

interface GitLabIssueSelectorProps {
  projectPath: string;
  selectedIssue: GitLabIssueSummary | null;
  onIssueChange: (issue: GitLabIssueSummary | null) => void;
  isOpen?: boolean;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}

export const GitLabIssueSelector: React.FC<GitLabIssueSelectorProps> = ({
  projectPath,
  selectedIssue,
  onIssueChange,
  isOpen = false,
  className = '',
  disabled = false,
  placeholder: customPlaceholder,
}) => {
  const [availableIssues, setAvailableIssues] = useState<GitLabIssueSummary[]>([]);
  const [isLoadingIssues, setIsLoadingIssues] = useState(false);
  const [issueListError, setIssueListError] = useState<string | null>(null);
  const [hasRequestedIssues, setHasRequestedIssues] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<GitLabIssueSummary[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const isMountedRef = useRef(true);
  const [visibleCount, setVisibleCount] = useState(10);

  const canListGitlab =
    typeof window !== 'undefined' && !!window.electronAPI?.gitlabInitialFetch && !!projectPath;
  const issuesLoaded = availableIssues.length > 0;
  const isDisabled = disabled || isLoadingIssues || !!issueListError || !issuesLoaded;

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
    if (!canListGitlab) return;
    const api = window.electronAPI;
    if (!api?.gitlabInitialFetch) {
      setAvailableIssues([]);
      setIssueListError('GitLab issue list unavailable in this build.');
      setHasRequestedIssues(true);
      return;
    }
    setIsLoadingIssues(true);
    try {
      const result = await api.gitlabInitialFetch(projectPath, 50);
      if (!isMountedRef.current) return;
      if (!result?.success) throw new Error(result?.error || 'Failed to load GitLab issues.');
      setAvailableIssues(result.issues ?? []);
      setIssueListError(null);
    } catch (error) {
      if (!isMountedRef.current) return;
      setAvailableIssues([]);
      setIssueListError(error instanceof Error ? error.message : 'Failed to load GitLab issues.');
    } finally {
      if (!isMountedRef.current) return;
      setIsLoadingIssues(false);
      setHasRequestedIssues(true);
    }
  }, [canListGitlab, projectPath]);

  useEffect(() => {
    if (!isOpen || !canListGitlab || isLoadingIssues || hasRequestedIssues) return;
    loadIssues();
  }, [isOpen, canListGitlab, isLoadingIssues, hasRequestedIssues, loadIssues]);

  const searchIssues = useCallback(
    async (term: string) => {
      if (!term.trim()) {
        setSearchResults([]);
        setIsSearching(false);
        return;
      }
      const api = window.electronAPI;
      if (!api?.gitlabSearchIssues) return;
      setIsSearching(true);
      try {
        const result = await api.gitlabSearchIssues(projectPath, term.trim(), 20);
        if (!isMountedRef.current) return;
        setSearchResults(result?.success ? (result.issues ?? []) : []);
        if (result?.success) {
          void (async () => {
            const { captureTelemetry } = await import('../lib/telemetryClient');
            captureTelemetry('gitlab_issues_searched');
          })();
        }
      } catch {
        if (isMountedRef.current) setSearchResults([]);
      } finally {
        if (isMountedRef.current) setIsSearching(false);
      }
    },
    [projectPath]
  );

  useEffect(() => {
    const t = setTimeout(() => void searchIssues(searchTerm), 300);
    return () => clearTimeout(t);
  }, [searchTerm, searchIssues]);

  useEffect(() => {
    setVisibleCount(10);
  }, [searchTerm]);

  const displayIssues = useMemo(() => {
    return searchTerm.trim() ? searchResults : availableIssues;
  }, [searchTerm, searchResults, availableIssues]);

  const showIssues = useMemo(
    () => displayIssues.slice(0, Math.max(10, visibleCount)),
    [displayIssues, visibleCount]
  );

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 16) {
        setVisibleCount((prev) => Math.min(prev + 10, displayIssues.length));
      }
    },
    [displayIssues.length]
  );

  const handleIssueSelect = (value: string) => {
    if (value === '__clear__') {
      onIssueChange(null);
      return;
    }
    const iid = parseInt(value, 10);
    const issue = displayIssues.find((i) => i.iid === iid) ?? null;
    if (issue) {
      void (async () => {
        const { captureTelemetry } = await import('../lib/telemetryClient');
        captureTelemetry('gitlab_issue_selected');
      })();
    }
    onIssueChange(issue);
  };

  if (!canListGitlab) {
    return (
      <div className={className}>
        <Input value="" placeholder="GitLab integration unavailable" disabled />
        <p className="mt-2 text-xs text-muted-foreground">
          Connect GitLab in Settings to browse issues.
        </p>
      </div>
    );
  }

  const issuePlaceholder =
    customPlaceholder ??
    (isLoadingIssues
      ? 'Loading…'
      : issueListError
        ? 'Connect your GitLab'
        : 'Select a GitLab issue');

  return (
    <div className={`min-w-0 max-w-full overflow-hidden ${className}`} style={{ maxWidth: '100%' }}>
      <Select
        value={selectedIssue ? String(selectedIssue.iid) : '__clear__'}
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
                <GitLabIssuePreviewTooltip issue={selectedIssue}>
                  <span
                    className="inline-flex items-center gap-1.5 rounded border border-border bg-muted px-1.5 py-0.5 dark:border-border dark:bg-card"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <AgentLogo
                      logo={gitlabLogoSvg}
                      alt="GitLab"
                      className="h-3.5 w-3.5 text-foreground"
                    />
                    <span className="text-[11px] font-medium text-foreground">
                      #{selectedIssue.iid}
                    </span>
                  </span>
                </GitLabIssuePreviewTooltip>
                {selectedIssue.title ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                    <span className="text-foreground">-</span>
                    <span className="truncate text-muted-foreground">{selectedIssue.title}</span>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <AgentLogo
                  logo={gitlabLogoSvg}
                  alt="GitLab"
                  className="h-3.5 w-3.5 text-foreground"
                />
                {isLoadingIssues ? (
                  <>
                    <span className="truncate text-muted-foreground">Loading GitLab issues</span>
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
              placeholder="Search by title or description..."
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
                <GitLabIssuePreviewTooltip key={issue.id || issue.iid} issue={issue} side="left">
                  <SelectItem value={String(issue.iid)}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-border bg-muted px-1.5 py-0.5 dark:border-border dark:bg-card">
                        <AgentLogo
                          logo={gitlabLogoSvg}
                          alt="GitLab"
                          className="h-3.5 w-3.5 text-foreground"
                        />
                        <span className="text-[11px] font-medium text-foreground">
                          #{issue.iid}
                        </span>
                      </span>
                      {issue.title ? (
                        <span className="truncate text-foreground">{issue.title}</span>
                      ) : null}
                    </span>
                  </SelectItem>
                </GitLabIssuePreviewTooltip>
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

export default GitLabIssueSelector;
