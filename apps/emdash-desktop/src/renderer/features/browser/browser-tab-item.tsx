import { Globe, Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { TabItemProps } from '@renderer/features/tabs/core/tab-provider';
import {
  GenericTabDragPreview,
  GenericTabItem,
} from '@renderer/features/tabs/tab-bar/generic-tab-item';
import type { BrowserResolvedData } from './browser-tab-provider';

function browserTabLabel(tab: { session: BrowserResolvedData['session'] }): string {
  if (tab.session.title.trim()) return tab.session.title.trim();
  if (tab.session.currentUrl === 'about:blank') return 'Browser';
  try {
    return new URL(tab.session.currentUrl).host;
  } catch {
    return 'Browser';
  }
}

export const BrowserTabItem = observer(function BrowserTabItem({
  tab,
  host,
  ctx,
}: TabItemProps<BrowserResolvedData>) {
  const label = browserTabLabel(tab);

  return (
    <GenericTabItem
      tab={tab}
      host={host}
      ctx={ctx}
      label={label}
      preSlot={
        <span className="shrink-0 text-foreground-muted [&>svg]:h-3 [&>svg]:w-3">
          {tab.session.isLoading ? <Loader2 className="animate-spin" /> : <Globe />}
        </span>
      }
      hasError={!!tab.session.loadError}
    />
  );
});

export function BrowserTabDragPreview({
  tab,
}: {
  tab: { session: BrowserResolvedData['session'] };
}) {
  const label = browserTabLabel(tab);
  return (
    <GenericTabDragPreview
      preSlot={<Globe className="size-3 shrink-0 text-foreground-muted" />}
      label={label}
    />
  );
}
