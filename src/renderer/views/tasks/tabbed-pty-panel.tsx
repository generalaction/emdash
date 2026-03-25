import { observer } from 'mobx-react-lite';
import React, { useMemo } from 'react';
import { PaneSizingProvider } from '@renderer/core/pty/pane-sizing-context';
import { frontendPtyRegistry } from '@renderer/core/pty/pty';
import { TerminalPane } from '@renderer/core/pty/pty-pane';
import { TabViewProvider } from '@renderer/core/stores/generic-tab-view';

export interface TabbedPtyPanelProps<TEntity> {
  store: TabViewProvider<TEntity, never> | undefined;
  getSessionId: (entity: TEntity) => string;
  paneId: string;
  tabBar: React.ReactNode;
  emptyState: React.ReactNode;
}

export const TabbedPtyPanel = observer(function TabbedPtyPanel<TEntity>({
  store,
  getSessionId,
  paneId,
  tabBar,
  emptyState,
}: TabbedPtyPanelProps<TEntity>) {
  const tabs = store?.tabs ?? [];
  const activeTab = store?.activeTab;

  const allSessionIds = useMemo(
    () => tabs.map(getSessionId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabs, getSessionId]
  );

  const activeSessionId = activeTab ? getSessionId(activeTab) : null;

  if (tabs.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0">{tabBar}</div>
      <div className="flex min-h-0 flex-1 flex-col">
        <PaneSizingProvider paneId={paneId} sessionIds={allSessionIds}>
          {activeSessionId && frontendPtyRegistry.isReady(activeSessionId) && (
            <TerminalPane sessionId={activeSessionId} className="h-full w-full" />
          )}
        </PaneSizingProvider>
      </div>
    </div>
  );
}) as <TEntity>(props: TabbedPtyPanelProps<TEntity>) => React.ReactElement;
