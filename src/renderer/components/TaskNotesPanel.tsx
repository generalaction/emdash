import { useState } from 'react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './ui/collapsible';
import { ChevronRight, FileText, Sparkles, Loader2 } from 'lucide-react';
import { useTaskNotes } from '../hooks/useTaskNotes';
import type { Task } from '../types/chat';

interface TaskNotesPanelProps {
  task: Task | null;
  isArchived?: boolean;
}

export function TaskNotesPanel({ task, isArchived }: TaskNotesPanelProps) {
  const { manualNote, summary, isGenerating, error, ptyId, saveNote, generateSummary } =
    useTaskNotes(task?.id ?? null);
  const [isOpen, setIsOpen] = useState(() => {
    try {
      return localStorage.getItem('emdash:notesPanel:open') === 'true';
    } catch {
      return false;
    }
  });

  if (!task) return null;

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    try {
      localStorage.setItem('emdash:notesPanel:open', String(open));
    } catch {
      // ignore
    }
  };

  return (
    <Collapsible open={isOpen} onOpenChange={handleOpenChange} className="mt-2">
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5">
          <FileText className="h-3 w-3 opacity-50" />
          <span>Notes & Summary</span>
          <ChevronRight
            className={`ml-auto h-3 w-3 transition-transform ${isOpen ? 'rotate-90' : ''}`}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-2 pb-2">
        {/* Manual Notes */}
        <div className="mt-2">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Notes</label>
          <textarea
            className="w-full resize-y rounded-md border border-border bg-background p-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            rows={3}
            placeholder="Add notes about this task..."
            value={manualNote}
            onChange={(e) => saveNote(e.target.value)}
            disabled={isArchived}
          />
        </div>

        {/* Generated Summary */}
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">Summary</label>
            <button
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
              onClick={() => generateSummary()}
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
            <div className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
              {summary}
            </div>
          ) : (
            <p className="text-xs italic text-muted-foreground/60">
              {ptyId
                ? 'Click Generate to summarize terminal output'
                : 'Start a terminal session to enable summaries'}
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
