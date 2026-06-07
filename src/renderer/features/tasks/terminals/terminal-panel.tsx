import { Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import {
  useTaskViewContext,
  useTerminals,
  useWorkspace,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import {
  DEFAULT_TERMINAL_SHELL_AVAILABILITY,
  useTerminalShellAvailability,
} from '@renderer/lib/hooks/use-terminal-shell-availability';
import { useTabShortcuts } from '@renderer/lib/hooks/useTabShortcuts';
import { rpc } from '@renderer/lib/ipc';
import { panelDragStore } from '@renderer/lib/layout/panel-drag-store';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@renderer/lib/ui/resizable';
import { BoundShortcut } from '@renderer/lib/ui/shortcut';
import type { TerminalShellId } from '@shared/core/terminals/terminal-settings';
import { useIsActiveTask } from '../hooks/use-is-active-task';
import { TerminalDrawerSidebar } from './terminal-drawer-sidebar';
import { resolveTerminalPanelActiveItem } from './terminal-panel-selection';
import { TerminalPtyContent } from './terminal-pty-content';

export const TerminalsPanel = observer(function TerminalsPanel() {
  const { projectId, taskId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const taskView = useWorkspaceViewModel();
  const workspace = useWorkspace();
  const terminalMgr = useTerminals();
  const terminalTabView = taskView.terminalTabs;
  const lifecycleScriptsMgr = workspace.lifecycleScripts ?? null;
  const isActive = useIsActiveTask(taskId);
  const remoteConnectionId = workspace.sshConnectionId;
  const [isPanelFocused, setIsPanelFocused] = useState(false);
  const [shouldLoadShellAvailability, setShouldLoadShellAvailability] = useState(false);
  const { data: shellAvailability = DEFAULT_TERMINAL_SHELL_AVAILABILITY } =
    useTerminalShellAvailability(remoteConnectionId, { enabled: shouldLoadShellAvailability });

  const autoFocus =
    isActive && taskView.isTerminalDrawerOpen && taskView.focusedRegion === 'bottom';

  const terminalTabs = terminalTabView.tabs;
  const lifecycleScriptTabs = lifecycleScriptsMgr?.tabs ?? [];

  // Unified active item — spans both terminals and scripts sections.
  const activeItem = resolveTerminalPanelActiveItem({
    requestedActiveItem: taskView.terminalDrawerActiveItem,
    activeTerminalId: terminalTabView.activeTabId,
    terminalIds: terminalTabs.map((terminal) => terminal.data.id),
    scriptIds: lifecycleScriptTabs.map((script) => script.data.id),
  });

  const activeTerminalId = activeItem.kind === 'terminal' ? activeItem.id : undefined;

  const activeSession =
    activeItem.kind === 'terminal'
      ? (terminalMgr.sessions.get(activeTerminalId ?? '') ?? null)
      : (lifecycleScriptTabs.find((s) => s.data.id === activeItem.id)?.session ?? null);

  const allSessionIds = [
    ...terminalTabs
      .map((t) => terminalMgr.sessions.get(t.data.id)?.sessionId)
      .filter((id): id is string => Boolean(id)),
    ...lifecycleScriptTabs.map((s) => s.session.sessionId),
  ];

  const handleHoverTerminal = (id: string) => {
    const session = terminalMgr.sessions.get(id);
    if (session?.status === 'disconnected') void session.connect();
  };

  const activeStore =
    activeItem.kind === 'terminal' ? terminalTabView : (lifecycleScriptsMgr ?? undefined);
  useTabShortcuts(activeStore, { focused: isPanelFocused });

  const handleCreate = async (shell?: TerminalShellId) => {
    await taskView.openNewTerminal(shell);
  };

  const handleRunScript = (id: string) => {
    const script = lifecycleScriptsMgr?.tabs.find((s) => s.data.id === id);
    if (!script || script.isRunning) return;
    lifecycleScriptsMgr?.setActiveTab(id);
    taskView.setTerminalDrawerActiveItem({ kind: 'script', id });
    void rpc.terminals
      .runLifecycleScript({
        projectId,
        taskId,
        workspaceId,
        type: script.data.type,
      })
      .catch(() => {});
  };

  const handleStopScript = (id: string) => {
    const script = lifecycleScriptsMgr?.tabs.find((s) => s.data.id === id);
    if (!script) return;
    void rpc.terminals.stopLifecycleScript({
      projectId,
      taskId,
      workspaceId,
      type: script.data.type,
    });
  };

  const emptyState = (
    <EmptyState
      icon={<Terminal className="text-muted-foreground h-5 w-5" />}
      label="No terminals yet"
      description="Add a terminal to run shell commands in this task's working directory."
      action={
        <Button
          size="sm"
          variant="outline"
          onClick={() => void handleCreate()}
          className="flex items-center gap-2"
        >
          New terminal
          <BoundShortcut settingsKey="newTerminal" />
        </Button>
      }
    />
  );

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      id="terminal-drawer-inner"
      className="h-full"
      onFocus={() => {
        setIsPanelFocused(true);
        taskView.setFocusedRegion('bottom');
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsPanelFocused(false);
        }
      }}
    >
      <ResizablePanel id="terminal-drawer-pty" minSize="30%">
        <TerminalPtyContent
          className="h-full"
          activeSession={activeSession}
          allSessionIds={allSessionIds}
          paneId="terminal-drawer"
          autoFocus={autoFocus}
          emptyState={emptyState}
          remoteConnectionId={remoteConnectionId}
          workspaceId={workspaceId}
        />
      </ResizablePanel>
      <ResizableHandle
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          panelDragStore.setDragging(true);
        }}
        className="bg-transparent hover:bg-background-2"
        onPointerUp={() => panelDragStore.setDragging(false)}
        onPointerCancel={() => panelDragStore.setDragging(false)}
      />
      <ResizablePanel id="terminal-drawer-sidebar" defaultSize="25%" minSize="150px" maxSize="50%">
        <TerminalDrawerSidebar
          className="h-full"
          projectId={projectId}
          lifecycleScriptsMgr={lifecycleScriptsMgr}
          activeScriptId={activeItem.kind === 'script' ? activeItem.id : undefined}
          onSelectScript={(id) => {
            lifecycleScriptsMgr?.setActiveTab(id);
            taskView.setTerminalDrawerActiveItem({ kind: 'script', id });
          }}
          onRunScript={handleRunScript}
          onStopScript={handleStopScript}
          terminalTabView={terminalTabView}
          activeTerminalId={activeTerminalId}
          shellAvailability={shellAvailability}
          onShellMenuOpen={() => setShouldLoadShellAvailability(true)}
          onSelectTerminal={(id) => {
            terminalTabView.setActiveTab(id);
            taskView.setTerminalDrawerActiveItem({ kind: 'terminal', id });
          }}
          onAddTerminal={(shell) => void handleCreate(shell)}
          onRemoveTerminal={(id) => terminalTabView.removeTab(id)}
          onRenameTerminal={(id, name) => void terminalMgr?.renameTerminal(id, name)}
          onHoverTerminal={handleHoverTerminal}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
});
