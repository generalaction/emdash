import { Terminal } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { makePtySessionId } from '@shared/ptySessionId';
import { Button } from '@renderer/components/ui/button';
import { PaneSizingProvider } from '@renderer/core/pty/pane-sizing-context';
import { TerminalPane } from '@renderer/core/pty/pty-pane';
import { useParams } from '@renderer/core/view/navigation-provider';
import { useTaskViewContext } from '../task-view-context';
import { TerminalsTabs } from './tabs';

export function TerminalsPanel() {
  const { params } = useParams('task');
  const { terminalTabItems, activeTerminalId, setActiveTerminalId, createTerminal } =
    useTaskViewContext();

  const activeId = activeTerminalId ?? terminalTabItems[0]?.id ?? null;

  const allSessionIds = useMemo(
    () =>
      terminalTabItems.map((item) => makePtySessionId(params.projectId, params.taskId, item.id)),
    [terminalTabItems, params.projectId, params.taskId]
  );

  const sessionId = activeId ? makePtySessionId(params.projectId, params.taskId, activeId) : null;

  const handleCreate = useCallback(async () => {
    try {
      const terminal = await createTerminal();
      setActiveTerminalId(terminal.id);
    } catch (error) {
      console.error('Failed to create terminal:', error);
    }
  }, [createTerminal, setActiveTerminalId]);

  if (terminalTabItems.length === 0) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col items-center justify-center p-6">
        <div className="flex max-w-sm flex-col items-center text-center">
          <div
            className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-border/60 bg-muted/30"
            aria-hidden
          >
            <Terminal className="h-5 w-5 text-muted-foreground" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">No terminals yet</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Add a terminal to run shell commands in this task&apos;s working directory.
          </p>
          <Button className="mt-5" onClick={handleCreate}>
            New terminal
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0">
        <TerminalsTabs tabItems={terminalTabItems} activeId={activeId} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <PaneSizingProvider paneId="terminals" sessionIds={allSessionIds}>
          {sessionId && <TerminalPane sessionId={sessionId} className="h-full w-full" />}
        </PaneSizingProvider>
      </div>
    </div>
  );
}
