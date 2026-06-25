import { Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { TabItemProps } from '@renderer/features/tabs/core/tab-provider';
import {
  GenericTabDragPreview,
  GenericTabItem,
} from '@renderer/features/tabs/tab-bar/generic-tab-item';
import type { TerminalResolvedData } from './terminal-tab-provider';

export const TerminalTabItem = observer(function TerminalTabItem({
  tab,
  host,
  ctx,
}: TabItemProps<TerminalResolvedData>) {
  return (
    <GenericTabItem
      tab={tab}
      host={host}
      ctx={ctx}
      label={tab.terminal.data.name}
      preSlot={<Terminal className="size-3 shrink-0 text-foreground-muted" />}
      kindCommands={[
        {
          id: 'terminal:rename',
          label: 'Rename',
          group: 'edit',
          shortcut: 'tabRename',
          run: () => host.requestRename(tab.tabId),
        },
      ]}
      renameValue={tab.terminal.data.name}
    />
  );
});

export const TerminalTabDragPreview = observer(function TerminalTabDragPreview({
  tab,
}: {
  tab: { terminal: TerminalResolvedData['terminal'] };
}) {
  return (
    <GenericTabDragPreview
      preSlot={<Terminal className="size-3 shrink-0 text-foreground-muted" />}
      label={tab.terminal.data.name}
    />
  );
});
