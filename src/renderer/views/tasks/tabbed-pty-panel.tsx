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
}

export const TabbedPtyPanel = observer(function TabbedPtyPanel<TEntity>({
  store,
  getSessionId,
  getSession,
  paneId,
  tabBar,
  emptyState,
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
  const [isFocused, setIsFocused] = useState(false);

  // Re-focus the terminal whenever the active session changes
  useEffect(() => {
    terminalRef.current?.focus();
  }, [activeSessionId]);

  if (tabs.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <div
      className="flex h-full flex-col"
      onFocus={() => setIsFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsFocused(false);
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
