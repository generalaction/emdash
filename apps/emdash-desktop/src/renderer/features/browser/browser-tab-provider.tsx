import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { BrowserPane } from '@renderer/features/browser/browser-pane';
import { browserSessionStore } from '@renderer/features/browser/browser-session-store';
import { getAppSettingValueSnapshot } from '@renderer/features/settings/app-settings-client';
import type {
  TabEntry,
  TabHandle,
  TabProvider,
  TabViewContext,
  TabContentProps,
  ResolvedTab,
} from '@renderer/features/tabs/core/tab-provider';
import { createTabProvider } from '@renderer/features/tabs/core/tab-provider-registry';
import type { TaskTabContext } from '@renderer/features/tasks/stores/task-tab-context';
import { rpc } from '@renderer/lib/ipc';
import { normalizeBrowserProfileSelection } from '@shared/browser';
import type { BrowserSessionSnapshot } from '@shared/browser';
import { BrowserTabItem, BrowserTabDragPreview } from './browser-tab-item';
import { BrowserTabResource } from './browser-tab-resource';

export interface BrowserPayload {
  browserId: string;
  /** Session snapshot at the time the tab was opened or last serialized. */
  session: BrowserSessionSnapshot;
}

export interface BrowserOpenArgs {
  initialUrl?: string;
}

/**
 * Mounts BrowserPane for every open browser tab; visibility is managed via
 * visibility:hidden + inert so browser sessions survive tab switches.
 * When no browser tab is active, calls setActiveBrowser(null) so the browser
 * process stops responding to commands.
 */
const BrowserTabContent = observer(function BrowserTabContent({ host }: TabContentProps) {
  const browserTabs = host.resolvedTabs.filter(
    (t): t is ResolvedTab<BrowserTabResource> => t.kind === 'browser'
  );
  const activeTab = host.resolvedTabs.find((t) => t.isActive);
  const activeBrowserId =
    activeTab?.kind === 'browser' ? (activeTab.resource as BrowserTabResource).browserId : null;

  useEffect(() => {
    if (activeBrowserId !== null) return;
    void rpc.browser.setActiveBrowser(null);
  }, [activeBrowserId]);

  return (
    <>
      {browserTabs.map((tab) => {
        const browserId = tab.resource.browserId;
        const visible = activeBrowserId === browserId;
        return (
          <div
            key={browserId}
            className="absolute inset-0"
            style={{ visibility: visible ? 'visible' : 'hidden' }}
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore — `inert` is a valid HTML attribute in modern browsers but not yet in React types
            inert={visible ? undefined : ''}
          >
            <BrowserPane browserId={browserId} visible={visible} />
          </div>
        );
      })}
    </>
  );
});

export const browserTabProvider: TabProvider<
  'browser',
  BrowserPayload,
  BrowserTabResource,
  BrowserOpenArgs
> = createTabProvider({
  kind: 'browser',

  resourceKey: (payload) => payload.browserId,

  /**
   * Creates a new browser session and returns it as the payload.
   * Returns null to abort if session creation fails (shouldn't happen).
   */
  onBeforeOpen(args: BrowserOpenArgs, ctx: TabViewContext): BrowserPayload | null {
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
    return { browserId: session.browserId, session };
  },

  initialize(
    entry: TabEntry<BrowserPayload>,
    handle: TabHandle,
    _ctx: TabViewContext
  ): BrowserTabResource {
    return new BrowserTabResource(entry.payload, handle);
  },

  dispose(_entry: TabEntry<BrowserPayload>, resource: BrowserTabResource): void {
    resource.dispose();
  },

  /**
   * Persist the current live session state (URL, title, zoom, etc.) rather
   * than the snapshot from when the tab was opened.
   */
  getSerializablePayload(
    entry: TabEntry<BrowserPayload>,
    resource: BrowserTabResource
  ): BrowserPayload {
    const liveSession = resource.session;
    return {
      browserId: entry.payload.browserId,
      session: liveSession ?? entry.payload.session,
    };
  },

  TabItem: BrowserTabItem,
  DragPreview: BrowserTabDragPreview,
  Content: BrowserTabContent,

  title(_entry: TabEntry<BrowserPayload>, resource: BrowserTabResource): string {
    const session = resource.session;
    if (!session) return 'Browser';
    if (session.title.trim()) return session.title.trim();
    if (session.currentUrl === 'about:blank') return 'Browser';
    try {
      return new URL(session.currentUrl).host;
    } catch {
      return 'Browser';
    }
  },
});
