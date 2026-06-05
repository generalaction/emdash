import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useIsActiveTask } from '@renderer/features/tasks/hooks/use-is-active-task';
import { useTabGroupContext } from '@renderer/features/tasks/tabs/tab-group-context';
import {
  useConversations,
  useTaskViewContext,
  useWorkspace,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import { PaneSizingProvider } from '@renderer/lib/pty/pane-sizing-context';
import { PtyPane } from '@renderer/lib/pty/pty-pane';
import { TerminalSearchOverlay } from '@renderer/lib/pty/terminal-search-overlay';
import { useTerminalSearch } from '@renderer/lib/pty/use-terminal-search';
import { ContextBar } from './context-bar';
import type { ConversationStore } from './conversation-manager';

export const ConversationsPanel = observer(function ConversationsPanel() {
  const { taskId } = useTaskViewContext();
  const taskView = useWorkspaceViewModel();
  const conversations = useConversations();
  const workspace = useWorkspace();
  const workspaceId = useWorkspaceId();
  const { value: interfaceSettings } = useAppSettingsKey('interface');
  const { groupId, tabManager: tm } = useTabGroupContext();
  const isActive = useIsActiveTask(taskId);
  const remoteConnectionId = workspace.sshConnectionId;

  const autoFocus = isActive && taskView.focusedRegion === 'main';

  // Build session ID list for PaneSizingProvider (all open conversation tabs).
  const allSessionIds = useMemo(() => {
    return tm.resolvedTabs
      .filter((t) => t.kind === 'conversation')
      .map((t) => conversations.sessions.get(t.store.data.id)?.sessionId)
      .filter((id): id is string => Boolean(id));
  }, [tm.resolvedTabs, conversations.sessions]);

  const activeConversation: ConversationStore | undefined = tm.activeConversation;
  const activeSession = activeConversation
    ? (conversations.sessions.get(activeConversation.data.id) ?? null)
    : null;
  const activeSessionId = activeSession?.sessionId ?? null;

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<{ focus: () => void }>(null);
  const focusPendingRef = useRef(false);

  const {
    isSearchOpen,
    searchQuery,
    searchStatus,
    searchInputRef,
    closeSearch,
    handleSearchQueryChange,
    stepSearch,
  } = useTerminalSearch({
    terminal: activeSession?.pty?.terminal,
    containerRef: terminalContainerRef,
    enabled: Boolean(activeSession?.pty),
    onCloseFocus: () => terminalRef.current?.focus(),
  });

  useEffect(() => {
    if (!autoFocus) return;
    if (terminalRef.current) {
      terminalRef.current.focus();
      focusPendingRef.current = false;
    } else {
      containerRef.current?.focus();
      focusPendingRef.current = true;
    }
  }, [autoFocus, activeSessionId]);

  const sessionStatus = activeSession?.status;
  useEffect(() => {
    if (sessionStatus === 'ready' && focusPendingRef.current) {
      focusPendingRef.current = false;
      terminalRef.current?.focus();
    }
  }, [sessionStatus]);

  const onInterruptPress = activeConversation ? () => activeConversation.clearWorking() : undefined;
  const showContextBar = !(interfaceSettings?.hideContextBar ?? false);

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <div
          ref={containerRef}
          tabIndex={-1}
          className="flex h-full min-w-0 flex-1 flex-col outline-none"
          onFocus={() => {
            if (isActive) taskView.setFocusedRegion('main');
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              // focus left the panel — no region change needed
            }
          }}
        >
          <PaneSizingProvider paneId={`conversations-${groupId}`} sessionIds={allSessionIds}>
            <div className="flex min-h-0 flex-1 flex-col">
              {activeSessionId && activeSession?.status === 'ready' && activeSession.pty ? (
                <div ref={terminalContainerRef} className="relative flex h-full min-h-0 flex-1">
                  <TerminalSearchOverlay
                    isOpen={isSearchOpen}
                    fullWidth
                    searchQuery={searchQuery}
                    searchStatus={searchStatus}
                    searchInputRef={searchInputRef}
                    onQueryChange={handleSearchQueryChange}
                    onStep={stepSearch}
                    onClose={closeSearch}
                  />
                  <PtyPane
                    ref={terminalRef}
                    sessionId={activeSessionId}
                    pty={activeSession.pty}
                    className="h-full w-full"
                    onInterruptPress={onInterruptPress}
                    mapShiftEnterToCtrlJ
                    remoteConnectionId={remoteConnectionId}
                    workspaceId={workspaceId}
                  />
                </div>
              ) : null}
            </div>
          </PaneSizingProvider>
        </div>
      </div>
      {showContextBar && <ContextBar conversationId={tm.activeConversationId} />}
    </div>
  );
});
