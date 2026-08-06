import { toast } from '@emdash/ui/react/primitives';
import { openModal } from '@core/manifests/browser/modal-api';
import {
  normalizeBrowserUrl,
  type BrowserDataClearKind,
  type BrowserSessionSnapshot,
} from '@core/primitives/browser/api';
import { rpc } from '@renderer/lib/runtime/desktop-host-client';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import type { BrowserWebviewAdapter } from './browser-webview-types';

export function openBrowserUrlExternally(url: string): void {
  if (!canOpenBrowserUrlExternally(url)) return;
  const normalized = normalizeBrowserUrl(url);
  if (normalized.ok) {
    void rpc.app.openExternal(normalized.url);
  }
}

export function canOpenBrowserUrlExternally(url: string): boolean {
  const normalized = normalizeBrowserUrl(url);
  return normalized.ok && (normalized.protocol === 'http:' || normalized.protocol === 'https:');
}

export async function captureBrowserScreenshot(session: BrowserSessionSnapshot): Promise<void> {
  const result = await (
    await getDesktopWireClient()
  ).browser.captureScreenshot({
    browserId: session.browserId,
  });
  if (result.success) {
    toast('Screenshot copied to clipboard');
  } else {
    toast.error('Could not capture screenshot');
  }
}

export function clearBrowserData(
  session: BrowserSessionSnapshot,
  kind: BrowserDataClearKind,
  onSuccess: () => void
): Promise<void> {
  return getDesktopWireClient()
    .then((client) => client.browser.clearData({ browserId: session.browserId, kind }))
    .then((result) => {
      if (result.success) {
        onSuccess();
        return;
      }

      toast.error('Could not clear browser data', {
        description: 'Try again, or reload the browser view manually.',
      });
    })
    .catch((error: unknown) => {
      console.error('Failed to clear browser data', error);
      toast.error('Could not clear browser data', {
        description: error instanceof Error ? error.message : 'The browser data request failed.',
      });
    });
}

export function confirmClearBrowserStorage(
  session: BrowserSessionSnapshot,
  adapter: BrowserWebviewAdapter | null,
  profileLabel = 'this browser profile'
): void {
  void openModal('confirmActionModal', {
    title: 'Clear browser storage?',
    description: `This clears cookies, local storage, IndexedDB, and cache for ${profileLabel}. Browser tabs using the same storage boundary will be signed out.`,
    confirmLabel: 'Clear Storage',
    variant: 'destructive',
  }).then((outcome) => {
    if (outcome.success) {
      void clearBrowserData(session, 'storage', () => adapter?.reload());
    }
  });
}
