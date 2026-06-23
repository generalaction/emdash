import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import type { ResolvedTab } from '@renderer/features/tabs/core/tab-provider';
import { usePaneContext } from '@renderer/features/tabs/pane-context';
import { useIsActiveTask } from '@renderer/features/tasks/hooks/use-is-active-task';
import {
  useConversations,
  useTaskViewContext,
  useWorkspace,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import { PaneSizingContextProvider } from '@renderer/lib/pty/pane-sizing-context';
import { PtyPane } from '@renderer/lib/pty/pty-pane';
import { TerminalSearchOverlay } from '@renderer/lib/pty/terminal-search-overlay';
import { useTerminalSearch } from '@renderer/lib/pty/use-terminal-search';
import { ContextBar } from './context-bar';
import type { ConversationStore } from './conversation-manager';
import type { ConversationResolvedData } from './conversation-tab-provider';
import {
  activeConversation as getActiveConversation,
  activeConversationId as getActiveConversationId,
} from './pane-selectors';

export const ConversationsPanel = observer(function ConversationsPanel() {
  const { taskId } = useTaskViewContext();
  const taskView = useWorkspaceViewModel();
  const conversations = useConversations();
  const workspace = useWorkspace();
  const workspaceId = useWorkspaceId();
  const { value: interfaceSettings } = useAppSettingsKey('interface');
  const { pane } = usePaneContext();
  const isActive = useIsActiveTask(taskId);
  const remoteConnectionId = workspace.sshConnectionId;

  const autoFocus = isActive && taskView.focusedRegion === 'main';

  // Build session ID list for PaneSizingContextProvider (all open conversation tabs).
  const allSessionIds = useMemo(() => {
    return pane.resolvedTabs
      .filter((t): t is ResolvedTab<ConversationResolvedData> => t.kind === 'conversation')
      .map((t) => conversations.sessions.get(t.store.data.id)?.sessionId)
      .filter((id): id is string => Boolean(id));
  }, [pane.resolvedTabs, conversations.sessions]);

  const activeConversation: ConversationStore | undefined = getActiveConversation(
    pane,
    conversations
  );
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
  const hideContextBarTrigger = interfaceSettings?.hideContextBar ?? false;

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
          <PaneSizingContextProvider sessionIds={allSessionIds}>
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
          </PaneSizingContextProvider>
        </div>
      </div>
      <ContextBar
        conversationId={getActiveConversationId(pane)}
        hideTrigger={hideContextBarTrigger}
      />
    </div>
  );
});
