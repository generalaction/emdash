import { observer } from 'mobx-react-lite';
import { useEffect, useRef } from 'react';
import { tabProviderRegistry } from '@renderer/features/tasks/tabs/core/tab-provider-registry';
import { usePaneContext } from '@renderer/features/tasks/tabs/pane-context';
import { useTabShortcuts } from '@renderer/lib/hooks/useTabShortcuts';
import { PaneDropZone } from './tab-bar/draggable-tab';
import { TabBarActions } from './tab-bar/tab-bar-actions';

export const TabBar = observer(function TabBar() {
  const { paneId, pane, isFocusedPane } = usePaneContext();

  useTabShortcuts(pane, { focused: isFocusedPane });

  const resolvedTabs = pane.resolvedTabs;

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = pane.activeTabId;
    if (!id || !scrollContainerRef.current) return;
    const el = scrollContainerRef.current.querySelector<HTMLElement>(
      `[data-tabid="${CSS.escape(id)}"]`
    );
    el?.scrollIntoView({ behavior: 'instant', inline: 'nearest', block: 'nearest' });
  }, [pane.activeTabId]);

  return (
    <div className="task-tab-bar flex h-[41px] shrink-0 items-center justify-between border-b border-border bg-background-secondary">
      <div ref={scrollContainerRef} className="flex h-full w-full overflow-x-auto">
        {resolvedTabs.map((tab) => {
          if (!tabProviderRegistry.has(tab.kind)) return null;
          const def = tabProviderRegistry.get(tab.kind);
          const TabItemComponent = def.TabItem;
          return <TabItemComponent key={tab.tabId} tab={tab} host={pane} ctx={pane.ctx} />;
        })}
        <PaneDropZone paneId={paneId} />
      </div>
      <TabBarActions />
    </div>
  );
});
