import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  FileText,
  GitCompare,
  Edit3,
  Check,
  Trash2,
  Copy,
  Download,
  FolderOpen,
  Archive,
} from 'lucide-react';
import type { ContentOutput } from '@/types/electron-api';
import { useContentOutputs, groupOutputsByAgent } from '@/hooks/useContentOutputs';
import { OutputComparisonPanel } from './OutputComparisonPanel';
import { ContentOutputEditor } from './ContentOutputEditor';
import { ContentArchivePanel } from './ContentArchivePanel';
import { cn } from '@/lib/utils';

interface ContentOutputsPanelProps {
  taskId: string;
  className?: string;
}

type ViewMode = 'list' | 'compare' | 'edit' | 'archive';

/**
 * Panel displaying all content outputs for a task.
 * Supports viewing, comparing, editing, exporting, and selecting outputs.
 */
export function ContentOutputsPanel({ taskId, className }: ContentOutputsPanelProps) {
  const { outputs, selectedOutput, isLoading, error, selectOutput, updateOutput, deleteOutput } =
    useContentOutputs(taskId);

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [editingOutput, setEditingOutput] = useState<ContentOutput | null>(null);
  const [isCopying, setIsCopying] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const groupedOutputs = groupOutputsByAgent(outputs);

  const handleCopy = useCallback(async (output: ContentOutput) => {
    setIsCopying(output.id);
    try {
      await navigator.clipboard.writeText(output.content);
    } finally {
      setTimeout(() => setIsCopying(null), 1000);
    }
  }, []);

  const handleEdit = useCallback((output: ContentOutput) => {
    setEditingOutput(output);
    setViewMode('edit');
  }, []);

  const handleSaveEdit = useCallback(
    async (content: string) => {
      if (!editingOutput) return null;
      const result = await updateOutput(editingOutput.id, content);
      if (result) {
        setEditingOutput(result);
      }
      return result;
    },
    [editingOutput, updateOutput]
  );

  const handleSelectFromEdit = useCallback(async () => {
    if (!editingOutput) return false;
    return selectOutput(editingOutput.id);
  }, [editingOutput, selectOutput]);

  const handleCloseEdit = useCallback(() => {
    setEditingOutput(null);
    setViewMode('list');
  }, []);

  const handleDelete = useCallback(
    async (output: ContentOutput) => {
      if (confirm(`Delete this output from ${output.agentId} (v${output.version})?`)) {
        await deleteOutput(output.id);
      }
    },
    [deleteOutput]
  );

  // Export handlers
  const handleExportToFile = useCallback(async (outputId: string) => {
    setIsExporting(true);
    try {
      await window.electronAPI.contentExportFile({
        outputId,
        options: { includeMetadata: true },
      });
    } finally {
      setIsExporting(false);
    }
  }, []);

  const handleExportSelectedToFile = useCallback(async () => {
    if (!selectedOutput) return;
    await handleExportToFile(selectedOutput.id);
  }, [selectedOutput, handleExportToFile]);

  const handleExportToFolder = useCallback(async () => {
    setIsExporting(true);
    try {
      await window.electronAPI.contentExportFolder({
        taskId,
        options: { includeMetadata: true, filenameFormat: 'detailed' },
      });
    } finally {
      setIsExporting(false);
    }
  }, [taskId]);

  // Compare mode
  if (viewMode === 'compare') {
    return (
      <div className={cn('flex h-full flex-col', className)}>
        <OutputComparisonPanel
          outputs={outputs}
          onSelectOutput={selectOutput}
          onClose={() => setViewMode('list')}
        />
      </div>
    );
  }

  // Edit mode
  if (viewMode === 'edit' && editingOutput) {
    return (
      <div className={cn('flex h-full flex-col', className)}>
        <ContentOutputEditor
          output={editingOutput}
          onSave={handleSaveEdit}
          onSelect={handleSelectFromEdit}
          onClose={handleCloseEdit}
        />
      </div>
    );
  }

  // Archive mode
  if (viewMode === 'archive') {
    return (
      <div className={cn('flex h-full flex-col', className)}>
        <ContentArchivePanel
          outputs={outputs}
          onSelectVersion={selectOutput}
          onCopy={handleCopy}
          onExportFile={handleExportToFile}
          onExportFolder={handleExportToFolder}
          onClose={() => setViewMode('list')}
        />
      </div>
    );
  }

  // List mode
  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <FileText className="h-4 w-4" />
          Content Outputs
          {outputs.length > 0 && <Badge variant="secondary">{outputs.length}</Badge>}
        </h3>
        <div className="flex gap-2">
          {outputs.length > 0 && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewMode('archive')}
                title="View archive"
              >
                <Archive className="h-4 w-4" />
              </Button>
              {outputs.length >= 2 && (
                <Button variant="outline" size="sm" onClick={() => setViewMode('compare')}>
                  <GitCompare className="mr-1 h-3 w-3" />
                  Compare
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            Loading outputs...
          </div>
        ) : error ? (
          <div className="flex h-32 items-center justify-center text-destructive">{error}</div>
        ) : outputs.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center text-muted-foreground">
            <FileText className="mb-2 h-12 w-12 opacity-50" />
            <p>No outputs yet</p>
            <p className="text-xs">Outputs will appear here when agents generate content</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Selected output highlight */}
            {selectedOutput && (
              <Card className="border-primary bg-primary/5">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      Selected Output
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{selectedOutput.agentId}</Badge>
                      <Badge variant="secondary">v{selectedOutput.version}</Badge>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-3 font-mono text-xs">
                    {selectedOutput.content.slice(0, 500)}
                    {selectedOutput.content.length > 500 && '...'}
                  </pre>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button variant="ghost" size="sm" onClick={() => handleCopy(selectedOutput)}>
                      <Copy className="mr-1 h-3 w-3" />
                      {isCopying === selectedOutput.id ? 'Copied!' : 'Copy'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleEdit(selectedOutput)}>
                      <Edit3 className="mr-1 h-3 w-3" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleExportSelectedToFile}
                      disabled={isExporting}
                    >
                      <Download className="mr-1 h-3 w-3" />
                      Export
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleExportToFolder}
                      disabled={isExporting}
                    >
                      <FolderOpen className="mr-1 h-3 w-3" />
                      Export All
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Outputs by agent */}
            {Array.from(groupedOutputs.entries()).map(([agentId, agentOutputs]) => (
              <div key={agentId} className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span>{agentId}</span>
                  <Badge variant="secondary">
                    {agentOutputs.length} version{agentOutputs.length !== 1 ? 's' : ''}
                  </Badge>
                </div>
                <div className="space-y-2">
                  {agentOutputs.map((output) => (
                    <Card
                      key={output.id}
                      className={cn(
                        'cursor-pointer transition-colors hover:bg-muted/50',
                        output.selected && 'border-primary'
                      )}
                    >
                      <CardContent className="py-3">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">v{output.version}</Badge>
                              {output.selected && <Badge variant="default">Selected</Badge>}
                              <span className="text-xs text-muted-foreground">
                                {new Date(output.createdAt).toLocaleString()}
                              </span>
                            </div>
                            <pre className="mt-2 max-h-20 overflow-hidden whitespace-pre-wrap text-xs text-muted-foreground">
                              {output.content.slice(0, 200)}
                              {output.content.length > 200 && '...'}
                            </pre>
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopy(output);
                              }}
                              title="Copy to clipboard"
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleExportToFile(output.id);
                              }}
                              title="Export to file"
                              disabled={isExporting}
                            >
                              <Download className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEdit(output);
                              }}
                              title="Edit"
                            >
                              <Edit3 className="h-3 w-3" />
                            </Button>
                            {!output.selected && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  selectOutput(output.id);
                                }}
                                title="Select as preferred"
                              >
                                <Check className="h-3 w-3" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(output);
                              }}
                              title="Delete"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ContentOutputsPanel;
