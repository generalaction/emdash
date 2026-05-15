import { Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useState } from 'react';
import {
  useTaskViewContext,
  useTerminals,
  useWorkspace,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import { useTabShortcuts } from '@renderer/lib/hooks/useTabShortcuts';
import { rpc } from '@renderer/lib/ipc';
import { panelDragStore } from '@renderer/lib/layout/panel-drag-store';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@renderer/lib/ui/resizable';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { useIsActiveTask } from '../hooks/use-is-active-task';
import { TerminalDrawerSidebar } from './terminal-drawer-sidebar';
import { TerminalPtyContent } from './terminal-pty-content';

type ActiveItem = { kind: 'terminal'; id: string } | { kind: 'script'; id: string };

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

  const autoFocus =
    isActive && taskView.isTerminalDrawerOpen && taskView.focusedRegion === 'bottom';

  // Unified active item — spans both terminals and scripts sections.
  const [activeItem, setActiveItem] = useState<ActiveItem>(() => {
    if (terminalTabView.activeTabId) {
      return { kind: 'terminal', id: terminalTabView.activeTabId };
    }
    const firstScript = lifecycleScriptsMgr?.tabs[0];
    if (firstScript) {
      return { kind: 'script', id: firstScript.data.id };
    }
    return { kind: 'terminal', id: '' };
  });

  // Always derive the active terminal id from the MobX-authoritative store so that
  // auto-selection (e.g. after removal) is reflected without stale local state.
  const activeTerminalId =
    activeItem.kind === 'terminal' ? (terminalTabView.activeTabId ?? activeItem.id) : undefined;

  const activeSession =
    activeItem.kind === 'terminal'
      ? (terminalMgr.sessions.get(activeTerminalId ?? '') ?? null)
      : (lifecycleScriptsMgr?.tabs.find((s) => s.data.id === activeItem.id)?.session ?? null);

  const allSessionIds = useMemo(
    () => [
      ...terminalTabView.tabs
        .map((t) => terminalMgr.sessions.get(t.data.id)?.sessionId)
        .filter((id): id is string => Boolean(id)),
      ...(lifecycleScriptsMgr?.tabs ?? []).map((s) => s.session.sessionId),
    ],
    [terminalTabView.tabs, terminalMgr.sessions, lifecycleScriptsMgr?.tabs]
  );

  const handleHoverTerminal = (id: string) => {
    const session = terminalMgr.sessions.get(id);
    if (session?.status === 'disconnected') void session.connect();
  };

  const activeStore =
    activeItem.kind === 'terminal' ? terminalTabView : (lifecycleScriptsMgr ?? undefined);
  useTabShortcuts(activeStore, { focused: isPanelFocused });

  const handleCreate = async () => {
    const id = await taskView.openNewTerminal();
    if (id) setActiveItem({ kind: 'terminal', id });
  };

  const handleRunScript = () => {
    const activeScript =
      activeItem.kind === 'script'
        ? lifecycleScriptsMgr?.tabs.find((s) => s.data.id === activeItem.id)
        : null;
    if (!activeScript) return;
    activeScript.markRunning();
    void rpc.terminals
      .runLifecycleScript({
        projectId,
        workspaceId,
        type: activeScript.data.type,
      })
      .catch(() => {
        activeScript.markExited();
      });
  };

  const handleStopScript = () => {
    const activeScript =
      activeItem.kind === 'script'
        ? lifecycleScriptsMgr?.tabs.find((s) => s.data.id === activeItem.id)
        : null;
    if (!activeScript) return;
    void rpc.pty.sendInput(activeScript.session.sessionId, '\x03');
  };

  const emptyState = (
    <EmptyState
      icon={<Terminal className="h-5 w-5 text-muted-foreground" />}
      label="No terminals yet"
      description="Add a terminal to run shell commands in this task's working directory."
      action={
        <Button
          size="sm"
          variant="outline"
          onClick={handleCreate}
          className="flex items-center gap-2"
        >
          New terminal
          <ShortcutHint settingsKey="newTerminal" />
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
        />
      </ResizablePanel>
      <ResizableHandle
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          panelDragStore.setDragging(true);
        }}
        className="hover:bg-background-2 bg-transparent"
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
            setActiveItem({ kind: 'script', id });
          }}
          onRunScript={handleRunScript}
          onStopScript={handleStopScript}
          terminalTabView={terminalTabView}
          activeTerminalId={activeTerminalId}
          onSelectTerminal={(id) => {
            terminalTabView.setActiveTab(id);
            setActiveItem({ kind: 'terminal', id });
          }}
          onAddTerminal={() => void handleCreate()}
          onRemoveTerminal={(id) => terminalTabView.removeTab(id)}
          onRenameTerminal={(id, name) => void terminalMgr?.renameTerminal(id, name)}
          onHoverTerminal={handleHoverTerminal}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
});
