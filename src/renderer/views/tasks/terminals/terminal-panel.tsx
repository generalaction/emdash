import { Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';
import { makePtySessionId } from '@shared/ptySessionId';
import { Button } from '@renderer/components/ui/button';
import { EmptyState } from '@renderer/components/ui/empty-state';
import { getPaneContainer, PaneSizingProvider } from '@renderer/core/pty/pane-sizing-context';
import { frontendPtyRegistry } from '@renderer/core/pty/pty';
import { measureDimensions } from '@renderer/core/pty/pty-dimensions';
import { TerminalPane } from '@renderer/core/pty/pty-pane';
import { useTaskViewContext } from '../task-view-context';
import { getTaskStore, provisionedTask } from '../task-view-state';
import { TerminalsTabs, TerminalTabItem } from './terminal-tabs';

function getTerminalsPaneSize() {
  const container = getPaneContainer('terminals');
  return container ? (measureDimensions(container, 8, 16) ?? undefined) : undefined;
}

function nextTerminalName(names: string[]): string {
  const taken = new Set(
    names
      .map((n) => /^Terminal (\d+)$/.exec(n)?.[1])
      .filter(Boolean)
      .map(Number)
  );
  let n = 1;
  while (taken.has(n)) n++;
  return `Terminal ${n}`;
}

export const TerminalsPanel = observer(function TerminalsPanel() {
  const { projectId, taskId } = useTaskViewContext();
  const terminalMgr = provisionedTask(getTaskStore(projectId, taskId))?.terminals;

  const terminalStores = terminalMgr ? Array.from(terminalMgr.terminals.values()) : [];
  const terminals = terminalStores.map((t) => t.data);

  const tabItems = useMemo<TerminalTabItem[]>(
    () => terminals.map((t) => ({ kind: 'terminal' as const, id: t.id, name: t.name })),
    [terminals]
  );

  const activeId = terminalMgr?.tabs.activeTabId ?? tabItems[0]?.id ?? null;

  const allSessionIds = useMemo(
    () => tabItems.map((item) => makePtySessionId(projectId, taskId, item.id)),
    [tabItems, projectId, taskId]
  );

  const sessionId = activeId ? makePtySessionId(projectId, taskId, activeId) : null;

  const handleCreate = async () => {
    if (!terminalMgr) return;
    const id = crypto.randomUUID();
    const name = nextTerminalName(terminals.map((t) => t.name));
    try {
      await terminalMgr.createTerminal({
        id,
        projectId,
        taskId,
        name,
        initialSize: getTerminalsPaneSize(),
      });
    } catch (error) {
      console.error('Failed to create terminal:', error);
    }
  };

  if (tabItems.length === 0) {
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
        <TerminalsTabs
          tabItems={tabItems}
          activeId={activeId}
          projectId={projectId}
          taskId={taskId}
          terminalMgr={terminalMgr ?? null}
        />
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
