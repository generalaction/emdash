import { observer } from 'mobx-react-lite';
import React, { useEffect, useMemo, useRef } from 'react';
import { PaneSizingProvider } from '@renderer/lib/pty/pane-sizing-context';
import { TerminalPane } from '@renderer/lib/pty/pty-pane';
import { PtySession } from '@renderer/lib/pty/pty-session';
import { TabViewProvider } from '@renderer/lib/stores/generic-tab-view';
import { cn } from '@renderer/utils/utils';

export interface TabbedPtyPanelProps<TEntity> {
  store: TabViewProvider<TEntity, never> | undefined;
  getSessionId: (entity: TEntity) => string;
  getSession: (entity: TEntity) => PtySession;
  paneId: string;
  tabBar: React.ReactNode;
  emptyState: React.ReactNode;
  autoFocus?: boolean;
  onFocusChange?: (focused: boolean) => void;
  onEnterPress?: (entity: TEntity) => void;
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
  onEnterPress,
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
  const activeOnEnterPress = activeTab && onEnterPress ? () => onEnterPress(activeTab) : undefined;

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<{ focus: () => void }>(null);
  const focusPendingRef = useRef(false);

  // Fire when autoFocus becomes true (task switch) or the active session changes.
  // If the terminal is already mounted, focus immediately; otherwise hold focus on
  // the container so keyboard input has a home while the PTY is connecting.
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

  // Fire when the session transitions to 'ready' (MobX observer re-renders automatically
  // because activeSession?.status is read in the render body below).
  const sessionStatus = activeSession?.status;
  useEffect(() => {
    if (sessionStatus === 'ready' && focusPendingRef.current) {
      focusPendingRef.current = false;
      terminalRef.current?.focus();
    }
  }, [sessionStatus]);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="flex h-full flex-col outline-none"
      onFocus={() => {
        onFocusChange?.(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          onFocusChange?.(false);
        }
      }}
    >
      <div className="shrink-0">{tabBar}</div>
      <PaneSizingProvider paneId={paneId} sessionIds={allSessionIds}>
        {tabs.length === 0 ? (
          emptyState
        ) : (
          <div className={cn('flex min-h-0 flex-1 flex-col')}>
            {activeSessionId && activeSession?.status === 'ready' && activeSession.pty && (
              <TerminalPane
                ref={terminalRef}
                sessionId={activeSessionId}
                pty={activeSession.pty}
                className="h-full w-full"
                onEnterPress={activeOnEnterPress}
              />
            )}
          </div>
        )}
      </PaneSizingProvider>
    </div>
  );
}) as <TEntity>(props: TabbedPtyPanelProps<TEntity>) => React.ReactElement;
