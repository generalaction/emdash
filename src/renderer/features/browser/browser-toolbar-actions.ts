import { rpc } from '@renderer/lib/ipc';
import { showModal } from '@renderer/lib/modal/modal-provider';
import { normalizeBrowserUrl, type BrowserSessionSnapshot } from '@shared/browser';
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

export function confirmClearBrowserStorage(
  session: BrowserSessionSnapshot,
  adapter: BrowserWebviewAdapter | null
): void {
  showModal('confirmActionModal', {
    title: 'Clear browser storage?',
    description:
      'This clears cookies, local storage, IndexedDB, and cache for this browser session only.',
    confirmLabel: 'Clear Storage',
    variant: 'destructive',
    onSuccess: () => {
      void rpc.browser.clearStorage(session.browserId).then((result) => {
        if (result.success) adapter?.reload();
      });
    },
  });
}
