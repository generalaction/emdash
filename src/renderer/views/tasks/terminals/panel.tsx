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
  const { terminals, activeTerminalId, setActiveTerminalId, createTerminal } = useTaskViewContext();

  const activeId = activeTerminalId ?? terminals[0]?.id ?? null;
  const activeTerminal = terminals.find((t) => t.id === activeId) ?? null;

  const allSessionIds = useMemo(
    () => terminals.map((t) => makePtySessionId(params.projectId, params.taskId, t.id)),
    [terminals, params.projectId, params.taskId]
  );

  const sessionId = activeTerminal
    ? makePtySessionId(params.projectId, params.taskId, activeTerminal.id)
    : null;

  const handleCreate = useCallback(async () => {
    try {
      const terminal = await createTerminal();
      setActiveTerminalId(terminal.id);
    } catch (error) {
      console.error('Failed to create terminal:', error);
    }
  }, [createTerminal, setActiveTerminalId]);

  if (terminals.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Button onClick={handleCreate}>New Terminal</Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0">
        <TerminalsTabs />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <PaneSizingProvider paneId="terminals" sessionIds={allSessionIds}>
          {sessionId && <TerminalPane sessionId={sessionId} className="h-full w-full" />}
        </PaneSizingProvider>
      </div>
    </div>
  );
}
