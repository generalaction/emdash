import { detectPlatform, parseHotkey } from '@tanstack/react-hotkeys';
import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import type { TabHost } from '@renderer/features/tabs/core/tab-host';
import type { ResolvedTab, TabViewContext } from '@renderer/features/tabs/core/tab-provider';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { BoundShortcut, Shortcut } from '@renderer/lib/ui/shortcut';
import type { ShortcutSettingsKey } from '@shared/shortcuts';
import type { TabCommand } from './tab-commands';

const _PLATFORM = detectPlatform();

/** Renders a shortcut hint that works with both a settings key and a raw getter. */
function CmdShortcut({
  shortcut,
}: {
  shortcut?: ShortcutSettingsKey | (() => string | undefined);
}) {
  if (!shortcut) return null;
  if (typeof shortcut === 'function') {
    const raw = shortcut();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = raw ? (parseHotkey(raw, _PLATFORM) as any) : null;
    return parsed ? <Shortcut hotkey={parsed} className="ml-auto" /> : null;
  }
  return <BoundShortcut settingsKey={shortcut} className="ml-auto" />;
}

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
  ctx: TabViewContext;
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
      <ContextMenuTrigger className="flex h-full">{children}</ContextMenuTrigger>
      <ContextMenuContent finalFocus={false}>
        {visibleEngine.map((cmd) => (
          <ContextMenuItem key={cmd.id} onClick={() => void cmd.run()}>
            {cmd.icon ? <cmd.icon className="size-4" /> : null}
            {cmd.label}
            <CmdShortcut shortcut={cmd.shortcut} />
          </ContextMenuItem>
        ))}
        {visibleKind.length > 0 && visibleEngine.length > 0 && <ContextMenuSeparator />}
        {visibleKind.map((cmd) => (
          <ContextMenuItem key={cmd.id} onClick={() => void cmd.run()}>
            {cmd.icon ? <cmd.icon className="size-4" /> : null}
            {cmd.label}
            <CmdShortcut shortcut={cmd.shortcut} />
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
});
