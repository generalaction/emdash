import type { TerminalShellId } from '@emdash/core/primitives/terminal-shell/api';
import { EmptyState } from '@emdash/ui/react/components';
import { Button } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useIsActiveTask } from '@core/features/tasks/api/browser/hooks/use-is-active-task';
import { useTaskViewContext } from '@core/features/tasks/contributions/browser/task-view-context';
import { useTerminalShellAvailability } from '@core/features/terminals/api/browser/use-terminal-shell-availability';
import {
  TerminalDrawerTabBar,
  type TerminalShellMenuState,
} from '@core/features/terminals/browser/task-terminal/terminal-drawer-tab-bar';
import { resolveTerminalPanelActiveItem } from '@core/features/terminals/browser/task-terminal/terminal-panel-selection';
import { TerminalPtyContent } from '@core/features/terminals/browser/task-terminal/terminal-pty-content';
import { usePaneScope } from '@core/features/workbench/api/browser/tabs/use-pane-scope';
import {
  useTaskComposition,
  useTerminals,
  useWorkspace,
  useWorkspaceId,
} from '@core/features/workbench/api/browser/task-composition-context';
import { lifecycleScriptsStoreToken } from '@core/features/workspaces/contributions/browser/workspace-stores';
import { projectAvailabilityUi } from '@core/manifests/browser/project-availability-ui';
import { BoundShortcut } from '@core/primitives/keybindings/browser/shortcut';
import { ViewScopeInstanceProvider } from '@core/primitives/view-scopes/react';

export const TerminalsPanel = observer(function TerminalsPanel() {
  const { projectId, taskId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const taskView = useTaskComposition();
  const workspace = useWorkspace();
  const terminalMgr = useTerminals();
  const terminalTabView = taskView.terminalTabs;
  const lifecycleScriptsMgr = workspace.get(lifecycleScriptsStoreToken);
  const isActive = useIsActiveTask(taskId);
  const remoteConnectionId = workspace.sshConnectionId;
  const liveActionsDisabled = terminalMgr.hostAccess?.liveAction.kind === 'disabled';
  const liveActionDisabledReason = projectAvailabilityUi.getLiveActionDisabledReason(projectId);
  const [shouldLoadShellAvailability, setShouldLoadShellAvailability] = useState(false);
  const shellAvailabilityQuery = useTerminalShellAvailability(remoteConnectionId, {
    enabled: shouldLoadShellAvailability && !liveActionsDisabled,
  });
  const shellMenuState: TerminalShellMenuState = shellAvailabilityQuery.data
    ? { kind: 'ready', availability: shellAvailabilityQuery.data }
    : shellAvailabilityQuery.isError
      ? {
          kind: 'error',
          message:
            shellAvailabilityQuery.error instanceof Error
              ? shellAvailabilityQuery.error.message
              : 'Failed to load',
        }
      : { kind: 'loading' };

  const shouldAutoFocus =
    isActive && taskView.isTerminalDrawerOpen && taskView.focusedRegion === 'bottom';

  const lifecycleScriptTabs = lifecycleScriptsMgr?.tabs ?? [];
  const terminalIdsOpenInMain = new Set<string>();
  for (const group of taskView.paneLayout.groups) {
    for (const entry of group.pane.entries.values()) {
      if (entry.kind !== 'terminal') continue;
      const terminalId = (entry.state as { terminalId?: unknown }).terminalId;
      if (typeof terminalId === 'string') terminalIdsOpenInMain.add(terminalId);
    }
  }

  const terminalTabs = terminalTabView.tabs.filter(
    (terminal) => !terminalIdsOpenInMain.has(terminal.data.id)
  );

  // Unified active item — spans both terminals and scripts sections.
  const activeItem = resolveTerminalPanelActiveItem({
    requestedActiveItem: taskView.terminalDrawerActiveItem,
    activeTerminalId: terminalTabView.activeTabId,
    terminalIds: terminalTabs.map((terminal) => terminal.data.id),
    scriptIds: lifecycleScriptTabs.map((script) => script.data.id),
  });

  const activeTerminalId = activeItem.kind === 'terminal' ? activeItem.id : undefined;
  const activeScriptId = activeItem.kind === 'script' ? activeItem.id : undefined;

  const activeSession =
    activeItem.kind === 'terminal'
      ? (terminalMgr.sessions.get(activeItem.id) ?? null)
      : (lifecycleScriptTabs.find((script) => script.data.id === activeItem.id)?.session ?? null);

  const allSessionIds = [
    ...terminalTabs
      .map((t) => terminalMgr.sessions.get(t.data.id)?.sessionId)
      .filter((id): id is string => Boolean(id)),
    ...lifecycleScriptTabs.map((s) => s.session.sessionId),
  ];

  const handleHoverTerminal = (id: string) => {
    if (liveActionsDisabled) return;
    const session = terminalMgr.sessions.get(id);
    if (session?.status === 'disconnected') void session.connect();
  };

  const activeStore =
    activeItem.kind === 'script' && lifecycleScriptsMgr ? lifecycleScriptsMgr : terminalTabView;
  const {
    attachRef: attachPaneScope,
    instance: paneScopeInstance,
    isFocused,
  } = usePaneScope(`terminal-drawer:${projectId}:${taskId}`, activeStore);

  const handleCreate = async (shell?: TerminalShellId) => {
    if (liveActionsDisabled) return;
    await taskView.openNewTerminal(shell);
  };

  const handleShellMenuOpen = () => {
    if (liveActionsDisabled) return;
    if (!shouldLoadShellAvailability) {
      setShouldLoadShellAvailability(true);
      return;
    }
    if (!shellAvailabilityQuery.isFetching) void shellAvailabilityQuery.refetch();
  };

  const handleRunScript = (id: string) => {
    const script = lifecycleScriptsMgr?.tabs.find((s) => s.data.id === id);
    if (!script || script.isRunning) return;
    lifecycleScriptsMgr?.setActiveTab(id);
    taskView.setTerminalDrawerActiveItem({ kind: 'script', id });
    void script.run().catch(() => {});
  };

  const handleStopScript = (id: string) => {
    const script = lifecycleScriptsMgr?.tabs.find((s) => s.data.id === id);
    if (!script) return;
    script.stop();
  };

  const emptyState = (
    <EmptyState
      bare
      label="No terminals yet"
      description="Add a terminal to run shell commands in this task's working directory."
      action={
        <projectAvailabilityUi.LiveActionGuard projectId={projectId}>
          <Button
            disabled={liveActionsDisabled}
            size="sm"
            variant="secondary"
            onClick={() => void handleCreate()}
            className="flex items-center gap-2"
          >
            New terminal
            <BoundShortcut command="task.newTerminal" variant="keycaps" />
          </Button>
        </projectAvailabilityUi.LiveActionGuard>
      }
    />
  );

  return (
    <ViewScopeInstanceProvider instance={paneScopeInstance}>
      <div
        ref={attachPaneScope}
        tabIndex={-1}
        className="surface-paper flex h-full flex-col bg-(--em-surface)"
        onPointerDownCapture={(event) => event.currentTarget.focus({ preventScroll: true })}
        onFocus={() => {
          taskView.setFocusedRegion('bottom');
        }}
      >
        <TerminalDrawerTabBar
          isFocused={isFocused}
          projectId={projectId}
          liveActionsDisabled={liveActionsDisabled}
          lifecycleScriptsMgr={lifecycleScriptsMgr}
          activeScriptId={activeScriptId}
          onSelectScript={(id) => {
            lifecycleScriptsMgr?.setActiveTab(id);
            taskView.setTerminalDrawerActiveItem({ kind: 'script', id });
          }}
          onRunScript={handleRunScript}
          onStopScript={handleStopScript}
          terminals={terminalTabs}
          activeTerminalId={activeTerminalId}
          shellMenuState={shellMenuState}
          onShellMenuOpen={handleShellMenuOpen}
          onRetryShellAvailability={() => void shellAvailabilityQuery.refetch()}
          onSelectTerminal={(id) => {
            terminalTabView.setActiveTab(id);
            taskView.setTerminalDrawerActiveItem({ kind: 'terminal', id });
          }}
          onAddTerminal={(shell) => void handleCreate(shell)}
          onRemoveTerminal={(id) => terminalTabView.removeTab(id)}
          onRenameTerminal={(id, name) => void terminalMgr.renameTerminal(id, name)}
          onHoverTerminal={handleHoverTerminal}
        />
        <TerminalPtyContent
          className="min-h-0 flex-1"
          activeSession={activeSession}
          allSessionIds={allSessionIds}
          autoFocus={shouldAutoFocus}
          emptyState={emptyState}
          unavailableState={
            <EmptyState
              bare
              label="Terminal unavailable"
              description={liveActionDisabledReason ?? 'Live actions are unavailable.'}
            />
          }
          disabledReason={activeItem.kind === 'terminal' ? liveActionDisabledReason : null}
          remoteConnectionId={remoteConnectionId}
          workspaceId={workspaceId}
          terminalPaddingBottom={0}
        />
      </div>
    </ViewScopeInstanceProvider>
  );
});
