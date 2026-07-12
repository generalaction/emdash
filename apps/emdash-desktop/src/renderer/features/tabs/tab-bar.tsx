import { observer } from 'mobx-react-lite';
import { useEffect, useRef, type ReactNode } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { usePaneContext } from '@renderer/features/tabs/pane-context';
import { getHotkeyRevealModifier, useModifierHeld } from '@renderer/lib/hooks/use-modifier-held';
import { getEffectiveHotkey } from '@renderer/lib/hooks/useKeyboardShortcuts';
import { NUMBER_HOTKEY_COUNT } from '@shared/shortcuts';
import { PaneDropZone } from './tab-bar/draggable-tab';
import { TabNumberHintsContext } from './tab-bar/tab-number-hints';

export const TabBar = observer(function TabBar({ actionsSlot }: { actionsSlot?: ReactNode }) {
  const { paneId, pane } = usePaneContext();

  const resolvedTabs = pane.resolvedTabs;

  const { value: keyboard } = useAppSettingsKey('keyboard');
  const revealModifier = getHotkeyRevealModifier(getEffectiveHotkey('tabByNumber', keyboard));
  const revealHints = useModifierHeld(revealModifier);
  const numberHints = revealHints
    ? new Map(resolvedTabs.slice(0, NUMBER_HOTKEY_COUNT).map((tab, i) => [tab.tabId, i + 1]))
    : null;

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
    <div
      className="task-tab-bar flex h-[41px] shrink-0 items-center justify-between border-b border-border bg-background-secondary"
      onClick={() => pane.focusActiveContent()}
    >
      <div
        ref={scrollContainerRef}
        className="flex h-full w-full overflow-x-auto overflow-y-hidden"
      >
        <TabNumberHintsContext.Provider value={numberHints}>
          {resolvedTabs.map((tab) => {
            if (!pane.registry.has(tab.kind)) return null;
            const def = pane.registry.get(tab.kind);
            const TabItemComponent = def.TabBarItem;
            return <TabItemComponent key={tab.tabId} tab={tab} host={pane} ctx={pane.ctx} />;
          })}
        </TabNumberHintsContext.Provider>
        <PaneDropZone paneId={paneId} />
      </div>
      {actionsSlot}
    </div>
  );
});
