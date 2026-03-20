import { Search } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import linearLogoSvg from '../../assets/images/Linear.svg?raw';
import { useLinearIssues } from '../hooks/use-linear-issues';
import { type LinearIssueSummary } from '../types/linear';
import AgentLogo from './agent-logo';
import { LinearIssuePreviewTooltip } from './LinearIssuePreviewTooltip';
import { LinearStatusPill } from './LinearStatusPill';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger } from './ui/select';
import { Separator } from './ui/separator';
import { Spinner } from './ui/spinner';

interface LinearIssueSelectorProps {
  selectedIssue: LinearIssueSummary | null;
  onIssueChange: (issue: LinearIssueSummary | null) => void;
  isOpen?: boolean;
  className?: string;
  disabled?: boolean;
  autoOpen?: boolean;
  onAutoOpenHandled?: () => void;
  placeholder?: string;
}

export const LinearIssueSelector: React.FC<LinearIssueSelectorProps> = ({
  selectedIssue,
  onIssueChange,
  isOpen = false,
  className = '',
  disabled = false,
  autoOpen = false,
  onAutoOpenHandled,
  placeholder: customPlaceholder,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const {
    issues,
    isLoading,
    error,
    searchTerm,
    setSearchTerm,
    isSearching,
    showIssues,
    handleScroll,
  } = useLinearIssues({ enabled: isOpen });

  useEffect(() => {
    if (!isOpen) {
      setDropdownOpen(false);
      onIssueChange(null);
    }
  }, [isOpen, onIssueChange]);

  useEffect(() => {
    if (autoOpen) {
      setDropdownOpen(true);
      onAutoOpenHandled?.();
    }
  }, [autoOpen, onAutoOpenHandled]);

  const issuesLoaded = issues.length > 0;
  const isDisabled = disabled || isLoading || !!error || !issuesLoaded;

  const handleIssueSelect = (identifier: string) => {
    if (identifier === '__clear__') {
      onIssueChange(null);
      return;
    }
    const issue = issues.find((i) => i.identifier === identifier) ?? null;
    if (issue) {
      void (async () => {
        const { captureTelemetry } = await import('../lib/telemetryClient');
        captureTelemetry('linear_issue_selected');
      })();
    }
    onIssueChange(issue);
  };

  const issueHelperText = (() => {
    if (isOpen && !isLoading && !issuesLoaded && !error) {
      return 'No Linear issues available.';
    }
    return null;
  })();

  const issuePlaceholder =
    customPlaceholder ??
    (isLoading ? 'Loading…' : error ? 'Connect your Linear' : 'Select a Linear issue');

  return (
    <div className={`min-w-0 max-w-full overflow-hidden ${className}`} style={{ maxWidth: '100%' }}>
      <Select
        value={selectedIssue?.identifier || '__clear__'}
        onValueChange={(v) => v !== null && handleIssueSelect(v)}
        disabled={isDisabled}
        open={dropdownOpen}
        onOpenChange={(open) => setDropdownOpen(open)}
      >
        <SelectTrigger
          className="h-9 w-full overflow-hidden border-none bg-muted"
          style={{ maxWidth: '100%' }}
        >
          <div className="flex w-full items-center gap-2 overflow-hidden text-left text-foreground">
            {selectedIssue ? (
              <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                <LinearIssuePreviewTooltip issue={selectedIssue}>
                  <span
                    className="inline-flex items-center gap-1.5 rounded border border-border bg-muted px-1.5 py-0.5 dark:border-border dark:bg-card"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <AgentLogo
                      logo={linearLogoSvg}
                      alt="Linear"
                      className="h-3.5 w-3.5 text-foreground"
                    />
                    <span className="text-[11px] font-medium text-foreground">
                      {selectedIssue.identifier}
                    </span>
                  </span>
                </LinearIssuePreviewTooltip>
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
                  logo={linearLogoSvg}
                  alt="Linear"
                  className="h-3.5 w-3.5 text-foreground"
                />
                {isLoading ? (
                  <>
                    <span className="truncate text-muted-foreground">Loading Linear issues</span>
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
              placeholder="Search by name, ID, or assignee..."
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
                <LinearIssuePreviewTooltip
                  key={issue.id || issue.identifier}
                  issue={issue}
                  side="left"
                >
                  <SelectItem value={issue.identifier}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-border bg-muted px-1.5 py-0.5 dark:border-border dark:bg-card">
                        <AgentLogo
                          logo={linearLogoSvg}
                          alt="Linear"
                          className="h-3.5 w-3.5 text-foreground"
                        />
                        <span className="text-[11px] font-medium text-foreground">
                          {issue.identifier}
                        </span>
                      </span>
                      <LinearStatusPill state={issue.state} />
                      {issue.title ? (
                        <span className="truncate text-muted-foreground">{issue.title}</span>
                      ) : null}
                    </span>
                  </SelectItem>
                </LinearIssuePreviewTooltip>
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
      {issueHelperText ? (
        <p className="mt-2 text-xs text-muted-foreground">{issueHelperText}</p>
      ) : null}
    </div>
  );
};

export default LinearIssueSelector;
