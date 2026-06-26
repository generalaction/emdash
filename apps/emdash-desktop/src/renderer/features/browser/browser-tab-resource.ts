import { browserDiagnosticsStore } from '@renderer/features/browser/browser-diagnostics-store';
import { browserSessionStore } from '@renderer/features/browser/browser-session-store';
import type { TabHandle, TabResource } from '@renderer/features/tabs/core/tab-provider';
import { events, rpc } from '@renderer/lib/ipc';
import type { BrowserSessionSnapshot } from '@shared/browser';
import { browserOpenInNewTabChannel } from '@shared/events/browserEvents';

export interface BrowserPayload {
  browserId: string;
  /** Session snapshot at the time the tab was opened or last serialized. */
  session: BrowserSessionSnapshot;
}

/**
 * Domain resource for a single open browser tab.
 *
 * On construction, restores the browser session if needed (from snapshot).
 * On dispose, clears diagnostics, removes the session, and unregisters from RPC.
 * Subscribes to the open-in-new-tab event for this browserId and opens a sibling
 * browser tab via handle.openSibling().
 */
export class BrowserTabResource implements TabResource {
  readonly browserId: string;
  private readonly _unsubscribeOpenInNewTab: () => void;

  constructor(payload: BrowserPayload, handle: TabHandle) {
    this.browserId = payload.browserId;

    // Restore the session if it doesn't exist yet (snapshot restore path).
    // On fresh open, the session was already created in onBeforeOpen().
    if (!browserSessionStore.getSession(payload.browserId)) {
      browserSessionStore.restoreSession(payload.session, undefined);
    }

    // Subscribe to open-in-new-tab requests for this browser.
    this._unsubscribeOpenInNewTab = events.on(
      browserOpenInNewTabChannel,
      ({ sourceBrowserId, url }: { sourceBrowserId: string; url: string }) => {
        if (sourceBrowserId !== this.browserId) return;
        handle.openSibling('browser', { initialUrl: url });
      }
    );
  }

  dispose(): void {
    this._unsubscribeOpenInNewTab();
    browserDiagnosticsStore.clearBrowser(this.browserId);
    browserSessionStore.removeSession(this.browserId);
    void rpc.browser.unregisterSession(this.browserId);
  }

  /** Current live session snapshot (for display). */
  get session(): BrowserSessionSnapshot | undefined {
    return browserSessionStore.getSession(this.browserId);
  }
}
