import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { showModal } from '@renderer/lib/modal/modal-provider';
import {
  normalizeBrowserUrl,
  type BrowserDataClearKind,
  type BrowserSessionSnapshot,
} from '@shared/browser';

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
  const result = await rpc.browser.captureScreenshot(session.browserId);
  if (result.success) {
    toast({ title: 'Screenshot copied to clipboard' });
  } else {
    toast({ title: 'Could not capture screenshot', variant: 'destructive' });
  }
}

export function clearBrowserData(
  session: BrowserSessionSnapshot,
  kind: BrowserDataClearKind,
  onSuccess: () => void
): Promise<void> {
  return rpc.browser
    .clearData(session.browserId, kind)
    .then((result) => {
      if (result.success) {
        onSuccess();
        return;
      }

      toast({
        title: 'Could not clear browser data',
        description: 'Try again, or reload the browser view manually.',
        variant: 'destructive',
      });
    })
    .catch((error: unknown) => {
      console.error('Failed to clear browser data', error);
      toast({
        title: 'Could not clear browser data',
        description: error instanceof Error ? error.message : 'The browser data request failed.',
        variant: 'destructive',
      });
    });
}

export function confirmClearBrowserStorage(
  session: BrowserSessionSnapshot,
  onSuccess: () => void
): void {
  showModal('confirmActionModal', {
    title: 'Clear browser storage?',
    description:
      'This clears cookies, local storage, IndexedDB, and cache for this browser session only.',
    confirmLabel: 'Clear Storage',
    variant: 'destructive',
    onSuccess: () => {
      void clearBrowserData(session, 'storage', onSuccess);
    },
  });
}
