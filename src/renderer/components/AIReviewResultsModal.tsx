import React, { useState } from 'react';
import { DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Spinner } from './ui/spinner';
import { ScrollArea } from './ui/scroll-area';
import { BaseModalProps } from '@/contexts/ModalProvider';
import type { AIReviewResult, AIReviewIssue } from '@shared/reviewPreset';
import { AlertCircle, CheckCircle, Code, FileText, Wrench, Clock, Users } from 'lucide-react';

interface AIReviewResultsModalProps {
  results: AIReviewResult[];
  isLoading?: boolean;
  onRunAnotherReview?: () => void;
  onFixIssue?: (issue: AIReviewIssue, result: AIReviewResult) => void;
}

export type AIReviewResultsModalOverlayProps = BaseModalProps<void> &
  AIReviewResultsModalProps & {
    initialResults?: AIReviewResult[];
  };

export function AIReviewResultsModalOverlay({
  results: initialResults = [],
  isLoading = false,
  onRunAnotherReview,
  onFixIssue,
  onClose,
}: AIReviewResultsModalOverlayProps) {
  const [activeTab, setActiveTab] = useState<'all' | number>('all');
  const [expandedIssues, setExpandedIssues] = useState<Set<string>>(new Set());

  const allIssues = initialResults.flatMap((r) => r.issues);
  const severityOrder = { critical: 0, major: 1, minor: 2, info: 3 };

  const sortedIssues = [...allIssues].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
  );

  const toggleIssueExpanded = (issueId: string) => {
    setExpandedIssues((prev) => {
      const next = new Set(prev);
      if (next.has(issueId)) {
        next.delete(issueId);
      } else {
        next.add(issueId);
      }
      return next;
    });
  };

  const handleFix = (issue: AIReviewIssue, result: AIReviewResult) => {
    onFixIssue?.(issue, result);
  };

  const severityConfig = {
    critical: {
      label: 'Critical',
      color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
      icon: AlertCircle,
    },
    major: {
      label: 'Major',
      color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
      icon: AlertCircle,
    },
    minor: {
      label: 'Minor',
      color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
      icon: AlertCircle,
    },
    info: {
      label: 'Info',
      color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
      icon: AlertCircle,
    },
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };

  const totalIssues = allIssues.length;
  const criticalCount = allIssues.filter((i) => i.severity === 'critical').length;
  const majorCount = allIssues.filter((i) => i.severity === 'major').length;

  return (
    <DialogContent className="max-h-[calc(100vh-48px)] max-w-4xl overflow-hidden p-0">
      <DialogHeader className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <DialogTitle>AI Review Results</DialogTitle>
            {initialResults.length > 0 && (
              <Badge variant="outline" className="text-xs">
                <Users className="mr-1 h-3 w-3" />
                {initialResults.length} agent{initialResults.length > 1 ? 's' : ''}
              </Badge>
            )}
          </div>
          {initialResults.length > 0 && (
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                {formatDuration(initialResults[0]?.durationMs || 0)}
              </span>
              <span className="flex items-center gap-1">
                <FileText className="h-4 w-4" />
                {totalIssues} issue{totalIssues !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>
        {(criticalCount > 0 || majorCount > 0) && (
          <div className="flex gap-2 pt-2">
            {criticalCount > 0 && (
              <Badge className={`${severityConfig.critical.color} border-0`}>
                {criticalCount} critical
              </Badge>
            )}
            {majorCount > 0 && (
              <Badge className={`${severityConfig.major.color} border-0`}>{majorCount} major</Badge>
            )}
          </div>
        )}
      </DialogHeader>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Spinner size="lg" />
            <p className="text-sm text-muted-foreground">Running AI review...</p>
          </div>
        </div>
      ) : allIssues.length === 0 ? (
        <div className="flex h-64 items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <CheckCircle className="h-12 w-12 text-green-500" />
            <p className="text-lg font-medium">No issues found</p>
            <p className="text-sm text-muted-foreground">
              The review didn&apos;t find any significant issues.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Tab bar */}
          {initialResults.length > 1 && (
            <div className="flex border-b border-border px-6">
              <button
                type="button"
                onClick={() => setActiveTab('all')}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === 'all'
                    ? 'border-b-2 border-primary text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                All Issues ({allIssues.length})
              </button>
              {initialResults.map((result, index) => (
                <button
                  key={result.reviewId}
                  type="button"
                  onClick={() => setActiveTab(index)}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    activeTab === index
                      ? 'border-b-2 border-primary text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Agent {index + 1} ({result.issues.length})
                </button>
              ))}
            </div>
          )}

          {/* Issues list */}
          <ScrollArea className="max-h-[60vh] flex-1 overflow-y-auto">
            <div className="space-y-3 p-6">
              {sortedIssues.map((issue) => {
                const config = severityConfig[issue.severity];
                const SeverityIcon = config.icon;
                const isExpanded = expandedIssues.has(issue.id);

                return (
                  <div
                    key={issue.id}
                    className="rounded-lg border border-border bg-card transition-colors hover:bg-accent/50"
                  >
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          <Badge className={`${config.color} mt-0.5 shrink-0 border-0`}>
                            <SeverityIcon className="mr-1 h-3 w-3" />
                            {config.label}
                          </Badge>
                          <div className="min-w-0 flex-1">
                            <h4 className="text-sm font-medium leading-tight">{issue.title}</h4>
                            {issue.category && (
                              <p className="mt-1 text-xs text-muted-foreground">{issue.category}</p>
                            )}
                            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                              {issue.description}
                            </p>
                          </div>
                        </div>
                        {issue.codeSnapshot && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleIssueExpanded(issue.id)}
                            className="shrink-0"
                          >
                            <Code className="h-4 w-4" />
                          </Button>
                        )}
                      </div>

                      {/* File path and line range */}
                      {(issue.filePath || issue.lineRange) && (
                        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                          {issue.filePath && <span className="font-mono">{issue.filePath}</span>}
                          {issue.lineRange && (
                            <span className="font-mono">
                              L{issue.lineRange.start}-L{issue.lineRange.end}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Code snapshot */}
                      {issue.codeSnapshot && isExpanded && (
                        <div className="mt-3 rounded bg-muted p-3">
                          <pre className="overflow-x-auto font-mono text-xs leading-relaxed">
                            <code>{issue.codeSnapshot}</code>
                          </pre>
                        </div>
                      )}

                      {/* Actions */}
                      {issue.fixPrompt && (
                        <div className="mt-3 flex justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const result =
                                activeTab === 'all'
                                  ? initialResults[0]
                                  : initialResults[activeTab as number];
                              if (result) handleFix(issue, result);
                            }}
                            className="text-xs"
                          >
                            <Wrench className="mr-1 h-3 w-3" />
                            Fix
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </>
      )}

      <DialogFooter className="border-t border-border px-6 py-4">
        <Button variant="outline" onClick={onRunAnotherReview}>
          Run Another Review
        </Button>
        <Button onClick={onClose}>Close</Button>
      </DialogFooter>
    </DialogContent>
  );
}
