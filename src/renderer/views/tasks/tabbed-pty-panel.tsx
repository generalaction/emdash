import { observer } from 'mobx-react-lite';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PaneSizingProvider } from '@renderer/core/pty/pane-sizing-context';
import { TerminalPane } from '@renderer/core/pty/pty-pane';
import { TabViewProvider } from '@renderer/core/stores/generic-tab-view';
import { PtySession } from '@renderer/core/stores/pty-session';
import { cn } from '@renderer/lib/utils';

export interface TabbedPtyPanelProps<TEntity> {
  store: TabViewProvider<TEntity, never> | undefined;
  getSessionId: (entity: TEntity) => string;
  getSession: (entity: TEntity) => PtySession;
  paneId: string;
  tabBar: React.ReactNode;
  emptyState: React.ReactNode;
  autoFocus?: boolean;
  onFocusChange?: (focused: boolean) => void;
}

export const TabbedPtyPanel = observer(function TabbedPtyPanel<TEntity>({
  store,
  getSessionId,
  getSession,
  paneId,
  tabBar,
  emptyState,
  autoFocus,
  onFocusChange,
}: TabbedPtyPanelProps<TEntity>) {
  const tabs = useMemo(() => store?.tabs ?? [], [store?.tabs]);
  const activeTab = store?.activeTab;

  const allSessionIds = useMemo(
    () => tabs.map(getSessionId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabs, getSessionId]
  );

  const activeSessionId = activeTab ? getSessionId(activeTab) : null;
  const activeSession = activeTab ? getSession(activeTab) : null;

  const terminalRef = useRef<{ focus: () => void }>(null);
  const focusPendingRef = useRef(false);
  const [isFocused, setIsFocused] = useState(false);

  // Fire when autoFocus becomes true (task switch) or the active session changes.
  // If the terminal is already mounted, focus immediately; otherwise queue intent.
  useEffect(() => {
    if (!autoFocus) return;
    if (terminalRef.current) {
      terminalRef.current.focus();
      focusPendingRef.current = false;
    } else {
      focusPendingRef.current = true;
    }
  }, [autoFocus, activeSessionId]);

  // Fire when the session transitions to 'ready' (MobX observer re-renders automatically
  // because activeSession?.status is read in the render body below).
  const sessionStatus = activeSession?.status;
  useEffect(() => {
    if (sessionStatus === 'ready' && focusPendingRef.current) {
      focusPendingRef.current = false;
      terminalRef.current?.focus();
    }
  }, [sessionStatus]);

  if (tabs.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <div
      className="flex h-full flex-col"
      onFocus={() => {
        setIsFocused(true);
        onFocusChange?.(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsFocused(false);
          onFocusChange?.(false);
        }
      }}
    >
      <div className="shrink-0">{tabBar}</div>
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col transition-opacity duration-150',
          !isFocused && 'opacity-50'
        )}
      >
        <PaneSizingProvider paneId={paneId} sessionIds={allSessionIds}>
          {activeSessionId && activeSession?.status === 'ready' && activeSession.pty && (
            <TerminalPane
              ref={terminalRef}
              sessionId={activeSessionId}
              pty={activeSession.pty}
              className="h-full w-full"
            />
          )}
        </PaneSizingProvider>
      </div>
    </div>
  );
}) as <TEntity>(props: TabbedPtyPanelProps<TEntity>) => React.ReactElement;
