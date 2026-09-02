import { observer } from 'mobx-react-lite';
import { useEffect, useRef, type ReactNode } from 'react';
import { usePaneContext } from '@core/primitives/workbench-shell/browser/tabs/pane-context';
import { PaneDropZone } from './tab-bar/draggable-tab';

export const TabBar = observer(function TabBar({ trailingSlot }: { trailingSlot?: ReactNode }) {
  const { paneId, pane } = usePaneContext();

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
    // Any click in the tab bar (select, close, pin, empty space) should return
    // DOM focus to the active content. Child handlers run first; the rAF in
    // focusActiveContent() defers the focus call until after they settle.
    // The inline rename input stops propagation, so it keeps focus while editing.
    // Flat strip on the titlebar's surface so titlebar and tab strip read as
    // one continuous chrome area; tabs carry no fills — the active tab is
    // marked by text contrast plus an underline drawn inside the strip, just
    // above this container's bottom border.
    <div
      className="task-tab-bar flex h-[41px] shrink-0 items-center border-b border-border bg-background-secondary"
      onClick={() => pane.focusActiveContent()}
    >
      <div
        ref={scrollContainerRef}
        className="flex h-full w-full overflow-x-auto overflow-y-hidden"
      >
        {resolvedTabs.map((tab) => {
          if (!pane.registry.has(tab.kind)) return null;
          const def = pane.registry.get(tab.kind);
          const TabItemComponent = def.TabBarItem;
          return <TabItemComponent key={tab.tabId} tab={tab} host={pane} ctx={pane.ctx} />;
        })}
        {trailingSlot && (
          <div className="sticky right-0 z-20 flex h-full shrink-0 items-center bg-background-secondary px-1">
            {trailingSlot}
          </div>
        )}
        <PaneDropZone paneId={paneId} />
      </div>
    </div>
  );
});
