import { action } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { browserDiagnosticsStore } from '@renderer/features/browser/browser-diagnostics-store';
import { BrowserPane } from '@renderer/features/browser/browser-pane';
import { browserSessionStore } from '@renderer/features/browser/browser-session-store';
import { getAppSettingValueSnapshot } from '@renderer/features/settings/app-settings-client';
import type {
  TabProvider,
  TabItemProps,
  TabViewContext,
  TabContentProps,
  ResolvedTab,
  ResolveContext,
} from '@renderer/features/tabs/core/tab-provider';
import { TabContextMenu } from '@renderer/features/tabs/tab-bar/tab-context-menu';
import type { TaskTabContext } from '@renderer/features/tasks/stores/task-tab-context';
import { events, rpc } from '@renderer/lib/ipc';
import { normalizeBrowserProfileSelection, type BrowserSessionSnapshot } from '@shared/browser';
import { browserOpenInNewTabChannel } from '@shared/events/browserEvents';
import type { TabDescriptor } from '@shared/view-state';
import { BrowserTabEntry } from './browser-tab-entry';
import { BrowserTabItem, BrowserTabDragPreview } from './browser-tab-item';

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
        tab={tab}
        onSelect={() => host.setActiveTab(tab.tabId)}
        onPin={() => host.pin(tab.tabId)}
        onClose={() => host.requestCloseTab(tab.tabId)}
      />
    </TabContextMenu>
  );
}

/**
 * Mounts BrowserPane for every open browser tab; visibility is managed via
 * visibility:hidden + inert so browser sessions survive tab switches.
 * When no browser tab is active, calls setActiveBrowser(null) so the browser
 * process stops responding to commands.
 */
const BrowserTabContent = observer(function BrowserTabContent({ host }: TabContentProps) {
  const browserTabs = host.resolvedTabs.filter(
    (t): t is ResolvedTab<BrowserResolvedData> => t.kind === 'browser'
  );
  const activeTab = host.resolvedTabs.find((t) => t.isActive);
  const activeBrowserTab =
    activeTab?.kind === 'browser' ? (activeTab as ResolvedTab<BrowserResolvedData>) : null;
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
          <div
            key={tab.browserId}
            className="absolute inset-0"
            style={{ visibility: visible ? 'visible' : 'hidden' }}
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore — `inert` is a valid HTML attribute in modern browsers but not yet in React types
            inert={visible ? undefined : ''}
          >
            <BrowserPane browserId={tab.browserId} visible={visible} />
          </div>
        );
      })}
    </>
  );
});

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const browserTabProvider: TabProvider<
  'browser',
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

  deserialize(data: BrowserDescriptor, _ctx: TabViewContext): BrowserTabEntry {
    browserSessionStore.restoreSession(
      data.session,
      getAppSettingValueSnapshot('browser')?.profiles
    );
    return new BrowserTabEntry(data.browserId, data.isPreview, data.tabId);
  },

  TabItem: BrowserTabItemAdapter,
  DragPreview: BrowserTabDragPreview,
  Content: BrowserTabContent,

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

  open(args: BrowserOpenArgs, host, ctx: TabViewContext): void {
    const taskCtx = ctx as TaskTabContext;
    const browserSettings = getAppSettingValueSnapshot('browser');
    const profileId = normalizeBrowserProfileSelection(
      browserSettings?.defaultProfileId,
      browserSettings?.profiles
    );
    const session = browserSessionStore.createSession({
      projectId: taskCtx.projectId,
      workspaceId: taskCtx.workspaceId,
      taskId: taskCtx.taskId,
      profileId,
      initialUrl: args.initialUrl,
    });
    const entry = new BrowserTabEntry(session.browserId, false);
    host.attachEntry(entry, { activate: true });
  },

  onClose(entry: BrowserTabEntry, _ctx: TabViewContext): void {
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
