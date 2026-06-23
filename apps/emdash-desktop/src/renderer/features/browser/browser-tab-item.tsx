import { Globe, Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { ResolvedTab } from '@renderer/features/tabs/core/tab-provider';
import { TabCloseButton } from '@renderer/features/tabs/tab-bar/tab-close-button';
import { TabDragPreviewShell, TabItemShell } from '@renderer/features/tabs/tab-bar/tab-item-shell';
import { TabTitle } from '@renderer/features/tabs/tab-bar/tab-title';
import type { BrowserResolvedData } from './browser-tab-provider';

function browserTabLabel(tab: ResolvedTab<BrowserResolvedData>): string {
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
  onSelect,
  onPin,
  onClose,
}: {
  tab: ResolvedTab<BrowserResolvedData>;
  onSelect: () => void;
  onPin: () => void;
  onClose: () => void;
}) {
  const label = browserTabLabel(tab);
  const title = tab.isPreview ? `${label} (preview - double-click to keep)` : label;

  return (
    <TabItemShell
      tabId={tab.tabId}
      isActive={tab.isActive}
      title={title}
      onSelect={onSelect}
      onPin={onPin}
      onClose={onClose}
    >
      <span className="shrink-0 text-foreground-muted [&>svg]:h-3 [&>svg]:w-3">
        {tab.session.isLoading ? <Loader2 className="animate-spin" /> : <Globe />}
      </span>
      <TabTitle
        isActive={tab.isActive}
        isPreview={tab.isPreview}
        hasError={!!tab.session.loadError}
      >
        {label}
      </TabTitle>
      <TabCloseButton onClose={onClose} ariaLabel={`Close ${label}`} />
    </TabItemShell>
  );
});

export function BrowserTabDragPreview({ tab }: { tab: ResolvedTab<BrowserResolvedData> }) {
  const label = browserTabLabel(tab);
  return (
    <TabDragPreviewShell>
      <Globe className="size-3 shrink-0 text-foreground-muted" />
      <span className="max-w-[200px] truncate">{label}</span>
    </TabDragPreviewShell>
  );
}
