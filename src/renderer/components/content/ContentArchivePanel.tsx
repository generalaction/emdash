import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Archive,
  Clock,
  FileText,
  Check,
  Copy,
  Download,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  RotateCcw,
} from 'lucide-react';
import type { ContentOutput } from '@/types/electron-api';
import { cn } from '@/lib/utils';

interface ContentArchivePanelProps {
  outputs: ContentOutput[];
  onSelectVersion?: (id: string) => Promise<boolean>;
  onCopy?: (output: ContentOutput) => void;
  onExportFile?: (outputId: string) => void;
  onExportFolder?: () => void;
  onClose?: () => void;
  className?: string;
}

interface GroupedOutputs {
  date: string;
  outputs: ContentOutput[];
}

/**
 * Archive panel showing full history of content outputs.
 * Outputs are grouped by date and agent for easy navigation.
 */
export function ContentArchivePanel({
  outputs,
  onSelectVersion,
  onCopy,
  onExportFile,
  onExportFolder,
  onClose,
  className,
}: ContentArchivePanelProps) {
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Group outputs by date
  const groupedByDate = useMemo(() => {
    const groups = new Map<string, ContentOutput[]>();

    for (const output of outputs) {
      const date = new Date(output.createdAt).toLocaleDateString();
      const existing = groups.get(date) || [];
      existing.push(output);
      groups.set(date, existing);
    }

    // Sort dates descending (newest first)
    const sortedEntries = Array.from(groups.entries()).sort((a, b) => {
      const dateA = new Date(a[1][0].createdAt);
      const dateB = new Date(b[1][0].createdAt);
      return dateB.getTime() - dateA.getTime();
    });

    return sortedEntries.map(([date, outputs]) => ({
      date,
      outputs: outputs.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    }));
  }, [outputs]);

  // Group outputs by agent within each date
  const getOutputsByAgent = (dateOutputs: ContentOutput[]) => {
    const groups = new Map<string, ContentOutput[]>();

    for (const output of dateOutputs) {
      const existing = groups.get(output.agentId) || [];
      existing.push(output);
      groups.set(output.agentId, existing);
    }

    return Array.from(groups.entries());
  };

  const toggleDate = (date: string) => {
    const newExpanded = new Set(expandedDates);
    if (newExpanded.has(date)) {
      newExpanded.delete(date);
    } else {
      newExpanded.add(date);
    }
    setExpandedDates(newExpanded);
  };

  const toggleAgent = (key: string) => {
    const newExpanded = new Set(expandedAgents);
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedAgents(newExpanded);
  };

  const handleCopy = async (output: ContentOutput) => {
    if (onCopy) {
      onCopy(output);
    } else {
      await navigator.clipboard.writeText(output.content);
    }
    setCopiedId(output.id);
    setTimeout(() => setCopiedId(null), 1000);
  };

  const handleRestore = async (output: ContentOutput) => {
    if (onSelectVersion) {
      await onSelectVersion(output.id);
    }
  };

  if (outputs.length === 0) {
    return (
      <div className={cn('flex h-full flex-col', className)}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Archive className="h-4 w-4" />
            Content Archive
          </h3>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <div className="text-center">
            <Archive className="mx-auto mb-2 h-12 w-12 opacity-50" />
            <p>No archived content</p>
            <p className="text-xs">Generated outputs will appear here</p>
          </div>
        </div>
      </div>
    );
  }

  const selectedOutput = outputs.find((o) => o.selected);
  const totalVersions = outputs.length;
  const uniqueAgents = new Set(outputs.map((o) => o.agentId)).size;

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Archive className="h-4 w-4" />
          Content Archive
          <Badge variant="secondary">{totalVersions} versions</Badge>
        </h3>
        <div className="flex items-center gap-2">
          {onExportFolder && (
            <Button variant="outline" size="sm" onClick={onExportFolder}>
              <FolderOpen className="mr-1 h-3 w-3" />
              Export All
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="border-b bg-muted/50 px-4 py-2">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <FileText className="h-3 w-3" />
            {totalVersions} total outputs
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {groupedByDate.length} dates
          </span>
          <span>{uniqueAgents} agents</span>
          {selectedOutput && (
            <span className="flex items-center gap-1 text-primary">
              <Check className="h-3 w-3" />
              Selected: {selectedOutput.agentId} v{selectedOutput.version}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="space-y-3">
          {groupedByDate.map(({ date, outputs: dateOutputs }) => {
            const isDateExpanded = expandedDates.has(date);
            const outputsByAgent = getOutputsByAgent(dateOutputs);

            return (
              <Card key={date}>
                <CardHeader className="cursor-pointer py-2" onClick={() => toggleDate(date)}>
                  <CardTitle className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      {isDateExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      {date}
                    </span>
                    <Badge variant="outline">{dateOutputs.length} outputs</Badge>
                  </CardTitle>
                </CardHeader>

                {isDateExpanded && (
                  <CardContent className="space-y-3 pt-0">
                    {outputsByAgent.map(([agentId, agentOutputs]) => {
                      const agentKey = `${date}-${agentId}`;
                      const isAgentExpanded = expandedAgents.has(agentKey);

                      return (
                        <div key={agentKey} className="rounded-md border">
                          <div
                            className="flex cursor-pointer items-center justify-between p-2 hover:bg-muted/50"
                            onClick={() => toggleAgent(agentKey)}
                          >
                            <span className="flex items-center gap-2 text-sm">
                              {isAgentExpanded ? (
                                <ChevronDown className="h-3 w-3" />
                              ) : (
                                <ChevronRight className="h-3 w-3" />
                              )}
                              <Badge variant="outline">{agentId}</Badge>
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {agentOutputs.length} version{agentOutputs.length !== 1 ? 's' : ''}
                            </span>
                          </div>

                          {isAgentExpanded && (
                            <div className="space-y-2 border-t p-2">
                              {agentOutputs
                                .sort((a, b) => b.version - a.version)
                                .map((output) => (
                                  <div
                                    key={output.id}
                                    className={cn(
                                      'rounded-md border p-2',
                                      output.selected && 'border-primary bg-primary/5'
                                    )}
                                  >
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <Badge variant="secondary">v{output.version}</Badge>
                                        {output.selected && (
                                          <Badge variant="default">Selected</Badge>
                                        )}
                                        <span className="text-xs text-muted-foreground">
                                          {new Date(output.createdAt).toLocaleTimeString()}
                                        </span>
                                      </div>
                                      <div className="flex gap-1">
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-6 w-6"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleCopy(output);
                                          }}
                                          title="Copy to clipboard"
                                        >
                                          <Copy className="h-3 w-3" />
                                        </Button>
                                        {onExportFile && (
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onExportFile(output.id);
                                            }}
                                            title="Export to file"
                                          >
                                            <Download className="h-3 w-3" />
                                          </Button>
                                        )}
                                        {!output.selected && onSelectVersion && (
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleRestore(output);
                                            }}
                                            title="Restore this version"
                                          >
                                            <RotateCcw className="h-3 w-3" />
                                          </Button>
                                        )}
                                      </div>
                                    </div>
                                    <pre className="mt-2 max-h-20 overflow-hidden whitespace-pre-wrap text-xs text-muted-foreground">
                                      {output.content.slice(0, 200)}
                                      {output.content.length > 200 && '...'}
                                    </pre>
                                    {copiedId === output.id && (
                                      <span className="text-xs text-primary">Copied!</span>
                                    )}
                                  </div>
                                ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default ContentArchivePanel;
