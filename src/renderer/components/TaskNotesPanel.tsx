import React, { useState } from 'react';
import { ChevronRight, FileText, Sparkles, Loader2 } from 'lucide-react';
import { useTaskNotes } from '../hooks/useTaskNotes';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './ui/collapsible';
import { MarkdownRenderer } from './ui/markdown-renderer';

interface TaskNotesPanelProps {
  taskId: string | null;
  ptyId: string | null;
  agentId?: string;
  isArchived?: boolean;
}

export function TaskNotesPanel({ taskId, ptyId, agentId, isArchived }: TaskNotesPanelProps) {
  const { manualNote, summary, isGenerating, error, saveNote, generateSummary } =
    useTaskNotes(taskId);

  const [isOpen, setIsOpen] = useState(() => {
    try {
      return localStorage.getItem('emdash:notesPanel:open') === 'true';
    } catch {
      return false;
    }
  });

  if (!taskId) return null;

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    try {
      localStorage.setItem('emdash:notesPanel:open', String(open));
    } catch {
      // ignore
    }
  };

  return (
    <Collapsible open={isOpen} onOpenChange={handleOpenChange}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 border-b border-border bg-muted px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/80 dark:bg-background dark:hover:bg-muted/20"
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-left">Notes & Summary</span>
          <ChevronRight
            className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-3 border-b border-border bg-background p-3">
          {/* Manual Notes */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Notes</label>
            <textarea
              className="w-full resize-y rounded-md border border-border bg-background p-2 text-xs placeholder-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
              rows={3}
              placeholder="Add notes about this task..."
              value={manualNote}
              onChange={(e) => saveNote(e.target.value)}
              disabled={isArchived}
            />
          </div>

          {/* Generated Summary */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">AI Summary</label>
              <button
                type="button"
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => ptyId && generateSummary(ptyId, agentId)}
                disabled={isGenerating || isArchived || !ptyId}
                title={
                  !ptyId ? 'No active terminal session' : 'Generate summary from terminal output'
                }
              >
                {isGenerating ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                {isGenerating ? 'Generating...' : 'Generate'}
              </button>
            </div>

            {error && <p className="mb-1 text-xs text-destructive">{error}</p>}

            {summary ? (
              <div className="max-h-64 overflow-y-auto rounded-md bg-muted/50 p-2 text-xs">
                <MarkdownRenderer content={summary} variant="compact" />
              </div>
            ) : (
              <p className="text-xs italic text-muted-foreground/50">
                {ptyId
                  ? 'Click Generate to summarize terminal output'
                  : 'Start a terminal session to enable summaries'}
              </p>
            )}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
