import { action } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { browserDiagnosticsStore } from '@renderer/features/browser/browser-diagnostics-store';
import { BrowserPane } from '@renderer/features/browser/browser-pane';
import { browserSessionStore } from '@renderer/features/browser/browser-session-store';
import { getAppSettingValueSnapshot } from '@renderer/features/settings/app-settings-client';
import {
  BrowserTabItem,
  BrowserTabDragPreview,
} from '@renderer/features/tasks/view/tab-bar/browser-tab-item';
import { TabContextMenu } from '@renderer/features/tasks/view/tab-bar/tab-context-menu';
import { events, rpc } from '@renderer/lib/ipc';
import { ShowHide } from '@renderer/lib/ui/show-hide';
import { normalizeBrowserProfileSelection, type BrowserSessionSnapshot } from '@shared/browser';
import { browserOpenInNewTabChannel } from '@shared/events/browserEvents';
import type { TabDescriptor } from '@shared/view-state';
import type {
  TabProvider,
  TabItemProps,
  TabKindContext,
  TabRendererProps,
  ResolvedTab,
  ResolveContext,
} from '../core/tab-provider';
import { registerTabProvider } from '../core/tab-provider-registry';
import { BrowserTabEntry } from '../pane-store';
import type { ResolvedBrowserTab } from '../pane-store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrowserOpenArgs {
  initialUrl?: string;
}

export interface BrowserResolvedData {
  browserId: string;
  session: BrowserSessionSnapshot;
}

type BrowserDescriptor = Extract<TabDescriptor, { kind: 'browser' }>;

// ---------------------------------------------------------------------------
// UI adapters
// ---------------------------------------------------------------------------

function BrowserTabItemAdapter({ tab, host, ctx }: TabItemProps<BrowserResolvedData>) {
  return (
    <TabContextMenu tab={tab} host={host} ctx={ctx}>
      <BrowserTabItem
        tab={tab as ResolvedBrowserTab}
        onSelect={() => host.setActiveTab(tab.tabId)}
        onPin={() => host.pin(tab.tabId)}
        onClose={() => host.requestCloseTab(tab.tabId)}
      />
    </TabContextMenu>
  );
}

function BrowserDragPreviewAdapter({ tab }: { tab: ResolvedTab<BrowserResolvedData> }) {
  return <BrowserTabDragPreview tab={tab as ResolvedBrowserTab} />;
}

/**
 * Mounts BrowserPane for every open browser tab (keepalive via ShowHide).
 * The active browser tab is the one whose tabId matches the host's active tab.
 * When no browser tab is active, calls setActiveBrowser(null) so the browser
 * process stops responding to commands.
 */
const BrowserTabRenderer = observer(function BrowserTabRenderer({ host }: TabRendererProps) {
  const browserTabs = host.resolvedTabs.filter(
    (t): t is ResolvedBrowserTab => t.kind === 'browser'
  );
  const activeTab = host.resolvedTabs.find((t) => t.isActive);
  const activeBrowserTab = activeTab?.kind === 'browser' ? (activeTab as ResolvedBrowserTab) : null;
  const activeBrowserId = activeBrowserTab?.browserId ?? null;

  useEffect(() => {
    if (activeBrowserId !== null) return;
    void rpc.browser.setActiveBrowser(null);
  }, [activeBrowserId]);

  return (
    <>
      {browserTabs.map((tab) => {
        const visible = activeBrowserId === tab.browserId;
        return (
          <ShowHide key={tab.browserId} visible={visible}>
            <BrowserPane browserId={tab.browserId} visible={visible} />
          </ShowHide>
        );
      })}
    </>
  );
});

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const browserTabProvider: TabProvider<
  BrowserTabEntry,
  BrowserResolvedData,
  BrowserDescriptor,
  BrowserOpenArgs
> = {
  kind: 'browser',

  resolve(entry: BrowserTabEntry, _ctx: ResolveContext): BrowserResolvedData | null {
    const session = browserSessionStore.getSession(entry.browserId);
    if (!session) return null;
    return { browserId: entry.browserId, session };
  },

  serialize(entry: BrowserTabEntry): BrowserDescriptor | null {
    const session = browserSessionStore.getSnapshot(entry.browserId);
    if (!session) return null;
    return {
      kind: 'browser',
      tabId: entry.tabId,
      browserId: entry.browserId,
      session,
      isPreview: entry.isPreview,
    };
  },

  deserialize(data: BrowserDescriptor, _ctx: TabKindContext): BrowserTabEntry {
    browserSessionStore.restoreSession(
      data.session,
      getAppSettingValueSnapshot('browser')?.profiles
    );
    return new BrowserTabEntry(data.browserId, data.isPreview, data.tabId);
  },

  TabItem: BrowserTabItemAdapter,
  DragPreview: BrowserDragPreviewAdapter,
  Renderer: BrowserTabRenderer,

  title(tab: ResolvedTab<BrowserResolvedData>): string {
    const { session } = tab;
    if (session.title.trim()) return session.title.trim();
    if (session.currentUrl === 'about:blank') return 'Browser';
    try {
      return new URL(session.currentUrl).host;
    } catch {
      return 'Browser';
    }
  },

  open(args: BrowserOpenArgs, host, ctx: TabKindContext): void {
    const browserSettings = getAppSettingValueSnapshot('browser');
    const profileId = normalizeBrowserProfileSelection(
      browserSettings?.defaultProfileId,
      browserSettings?.profiles
    );
    const session = browserSessionStore.createSession({
      projectId: ctx.projectId,
      workspaceId: ctx.workspaceId,
      taskId: ctx.taskId,
      profileId,
      initialUrl: args.initialUrl,
    });
    const entry = new BrowserTabEntry(session.browserId, false);
    host.attachEntry(entry, { activate: true });
  },

  onClose(entry: BrowserTabEntry, _ctx: TabKindContext): void {
    browserDiagnosticsStore.clearBrowser(entry.browserId);
    browserSessionStore.removeSession(entry.browserId);
    void rpc.browser.unregisterSession(entry.browserId);
  },

  mount(host, _ctx): () => void {
    return events.on(
      browserOpenInNewTabChannel,
      action(({ sourceBrowserId, url }: { sourceBrowserId: string; url: string }) => {
        const hasBrowser = host.findEntry(
          (e): e is BrowserTabEntry =>
            (e as BrowserTabEntry).kind === 'browser' &&
            (e as BrowserTabEntry).browserId === sourceBrowserId
        );
        if (!hasBrowser) return;
        host.openKind('browser', { initialUrl: url });
      })
    );
  },
};

registerTabProvider(browserTabProvider);
