import { Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useMemo } from 'react';
import { makePtySessionId } from '@shared/ptySessionId';
import { Button } from '@renderer/components/ui/button';
import { EmptyState } from '@renderer/components/ui/empty-state';
import { PaneSizingProvider } from '@renderer/core/pty/pane-sizing-context';
import { frontendPtyRegistry } from '@renderer/core/pty/pty';
import { TerminalPane } from '@renderer/core/pty/pty-pane';
import { useParams } from '@renderer/core/view/navigation-provider';
import { useTaskViewContext } from '../task-view-context';
import { TerminalsTabs } from './terminal-tabs';

export const TerminalsPanel = observer(function TerminalsPanel() {
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
      <EmptyState
        icon={<Terminal className="h-5 w-5 text-muted-foreground" />}
        label="No terminals yet"
        description="Add a terminal to run shell commands in this task's working directory."
        action={
          <Button size="sm" variant="outline" onClick={handleCreate}>
            New terminal
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0">
        <TerminalsTabs tabItems={terminalTabItems} activeId={activeId} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <PaneSizingProvider paneId="terminals" sessionIds={allSessionIds}>
          {sessionId && frontendPtyRegistry.isReady(sessionId) && (
            <TerminalPane sessionId={sessionId} className="h-full w-full" />
          )}
        </PaneSizingProvider>
      </div>
    </div>
  );
});
