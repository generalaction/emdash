import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import type {
  TabCommand,
  TabHost,
  TabKindContext,
  ResolvedTab,
} from '@renderer/features/tasks/tabs/core/tab-provider';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';

/**
 * Generic context menu wrapper for any tab kind.
 *
 * Provides engine built-in commands (Keep Open, Close Tab, Close Other Tabs) and
 * appends optional kind-specific commands from `kindCommands`. Engine commands are
 * in the "close" group; kind-specific commands are separated by a divider.
 */
export const TabContextMenu = observer(function TabContextMenu({
  tab,
  host,
  ctx: _ctx,
  kindCommands = [],
  children,
}: {
  tab: ResolvedTab;
  host: TabHost;
  ctx: TabKindContext;
  kindCommands?: TabCommand[];
  children: ReactNode;
}) {
  const engineCommands: TabCommand[] = [
    ...(tab.isPreview
      ? [
          {
            id: 'engine:keep-open',
            label: 'Keep Open',
            group: 'close' as const,
            run: () => host.pin(tab.tabId),
          },
        ]
      : []),
    {
      id: 'engine:close',
      label: 'Close Tab',
      group: 'close' as const,
      run: () => host.requestCloseTab(tab.tabId),
    },
    {
      id: 'engine:close-others',
      label: 'Close Other Tabs',
      group: 'close' as const,
      run: () => host.closeOthers(tab.tabId),
    },
  ];

  const visibleEngine = engineCommands.filter((c) => c.isAvailable?.() !== false);
  const visibleKind = kindCommands.filter((c) => c.isAvailable?.() !== false);

  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent finalFocus={false}>
        {visibleEngine.map((cmd) => (
          <ContextMenuItem key={cmd.id} onClick={() => void cmd.run()}>
            {cmd.icon ? <cmd.icon className="size-4" /> : null}
            {cmd.label}
          </ContextMenuItem>
        ))}
        {visibleKind.length > 0 && visibleEngine.length > 0 && <ContextMenuSeparator />}
        {visibleKind.map((cmd) => (
          <ContextMenuItem key={cmd.id} onClick={() => void cmd.run()}>
            {cmd.icon ? <cmd.icon className="size-4" /> : null}
            {cmd.label}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
});
