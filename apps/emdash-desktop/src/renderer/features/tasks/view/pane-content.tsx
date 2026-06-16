import { useDroppable } from '@dnd-kit/core';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { BrowserPane } from '@renderer/features/browser/browser-pane';
import { rpc } from '@renderer/lib/ipc';
import { ShowHide } from '@renderer/lib/ui/show-hide';
import { ConversationsPanel } from '../conversations/conversations-panel';
import { DiffView } from '../diff-view/main-panel/diff-view';
import { useTabGroupContext } from '../tabs/tab-group-context';
import type { ResolvedBrowserTab } from '../tabs/tab-manager-store';
import { PaneEmptyState } from './pane-empty-state';
import { resolvePaneRenderer } from './pane-renderer';
import { FileRenderer } from './renderers/file-renderer';
import { TabBar } from './tab-bar';

/** The content for a single pane: tab bar + renderer area. */
export const PaneContent = observer(function PaneContent() {
  const { groupId, tabManager: paneTabManager } = useTabGroupContext();
  const { setNodeRef: setContentDropRef, isOver: isOverContent } = useDroppable({
    id: `pane-content-${groupId}`,
  });

  const paneRenderer = resolvePaneRenderer(paneTabManager);
  const browserTabs = paneTabManager.resolvedTabs.filter(
    (tab): tab is ResolvedBrowserTab => tab.kind === 'browser'
  );
  const activeBrowserId = paneRenderer?.kind === 'browser' ? paneRenderer.browserId : null;

  useEffect(() => {
    if (activeBrowserId !== null) return;
    void rpc.browser.setActiveBrowser(null);
  }, [activeBrowserId]);

  if (!paneRenderer) {
    return <PaneEmptyState />;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TabBar />
      <div ref={setContentDropRef} className="relative min-h-0 flex-1">
        {isOverContent && (
          <div className="pointer-events-none absolute inset-0 z-20 bg-foreground/10" />
        )}
        <ShowHide visible={paneRenderer.kind === 'pty-agent'}>
          <ConversationsPanel />
        </ShowHide>
        {browserTabs.map((tab) => {
          const visible = activeBrowserId === tab.browserId;
          return (
            <ShowHide key={tab.browserId} visible={visible}>
              <BrowserPane browserId={tab.browserId} visible={visible} />
            </ShowHide>
          );
        })}
        {paneRenderer.kind === 'file' && <FileRenderer tab={paneRenderer.tab} />}
        {paneRenderer.kind === 'file-diff' && <DiffView tab={paneRenderer.tab} />}
      </div>
    </div>
  );
});
