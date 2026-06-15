import { Globe, Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { BrowserFavicon } from '@renderer/features/browser/browser-favicon';
import type { BrowserSessionSnapshot } from '@shared/browser';
import type { ResolvedBrowserTab } from '../../tabs/tab-manager-store';
import { TabCloseButton } from './tab-close-button';
import { TabDragPreviewShell, TabItemShell } from './tab-item-shell';
import { TabTitle } from './tab-title';

function browserTabLabel(tab: ResolvedBrowserTab): string {
  if (tab.session.title.trim()) return tab.session.title.trim();
  if (tab.session.currentUrl === 'about:blank') return 'Browser';
  try {
    return new URL(tab.session.currentUrl).host;
  } catch {
    return 'Browser';
  }
}

const BrowserTabFavicon = observer(function BrowserTabFavicon({
  session,
}: {
  session: BrowserSessionSnapshot;
}) {
  if (session.isLoading) {
    return (
      <span className="shrink-0 text-foreground-muted [&>svg]:h-3 [&>svg]:w-3">
        <Loader2 className="animate-spin" />
      </span>
    );
  }

  return (
    <BrowserFavicon
      faviconUrl={session.faviconUrl}
      className="size-3 shrink-0 rounded-sm"
      fallback={
        <span className="shrink-0 text-foreground-muted [&>svg]:h-3 [&>svg]:w-3">
          <Globe />
        </span>
      }
    />
  );
});

export const BrowserTabItem = observer(function BrowserTabItem({
  tab,
  onSelect,
  onPin,
  onClose,
}: {
  tab: ResolvedBrowserTab;
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
      <BrowserTabFavicon session={tab.session} />
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

export function BrowserTabDragPreview({ tab }: { tab: ResolvedBrowserTab }) {
  const label = browserTabLabel(tab);
  return (
    <TabDragPreviewShell>
      <Globe className="size-3 shrink-0 text-foreground-muted" />
      <span className="max-w-[200px] truncate">{label}</span>
    </TabDragPreviewShell>
  );
}
