import { webContents } from 'electron';
import { appSettingsService } from '@main/core/settings/settings-service';
import { configureBrowserProfileSession } from '@main/host/browser/browser-profile-session';
import { browserWebContentsRegistry } from '@main/host/browser/browser-webcontents-registry';
import { isBrowserPartition } from '@main/host/browser/webview-security';
import {
  browserProfilePartition,
  DEFAULT_BROWSER_PROFILE_ID,
  isBrowserDataClearKind,
  isBrowsingDataKind,
  type BrowserDataClearKind,
} from '@shared/browser';
import { createRPCController } from '@shared/lib/ipc/rpc';

export const browserController = createRPCController({
  registerSession: (args: { browserId: string; partition: string }) => {
    if (!args.browserId.trim() || !isBrowserPartition(args.partition)) {
      return { success: false as const, error: 'Invalid browser session' };
    }
    configureBrowserProfileSession(args.partition);
    browserWebContentsRegistry.registerSession(args);
    return { success: true as const };
  },

  unregisterSession: (browserId: string) => {
    browserWebContentsRegistry.unregisterSession(browserId);
    return { success: true as const };
  },

  bindWebContents: (args: { browserId: string; webContentsId: number }) => {
    const target = webContents.fromId(args.webContentsId);
    if (!target || target.isDestroyed()) {
      return { success: false as const };
    }
    return { success: browserWebContentsRegistry.bindWebContents(args.browserId, target) };
  },

  setActiveBrowser: (browserId: string | null) => {
    browserWebContentsRegistry.setActiveBrowser(browserId);
    return { success: true as const };
  },

  getActiveBrowser: () => ({ browserId: browserWebContentsRegistry.getActiveBrowser() }),

  openDevTools: (browserId: string) => ({
    success: import.meta.env.DEV && browserWebContentsRegistry.openDevTools(browserId),
  }),

  captureScreenshot: async (browserId: string) => ({
    success: await browserWebContentsRegistry.captureScreenshotToClipboard(browserId),
  }),

  clearData: async (browserId: string, kind: BrowserDataClearKind) => {
    if (!isBrowserDataClearKind(kind)) {
      return { success: false as const, error: 'Invalid browser data clear kind' };
    }
    return { success: await browserWebContentsRegistry.clearData(browserId, kind) };
  },

  clearProfileStorage: async (profileId: string) => ({
    success: await browserWebContentsRegistry.clearProfileStorage(profileId),
  }),

  clearBrowsingData: async (kind: string) => {
    if (!isBrowsingDataKind(kind)) {
      return { success: false as const, error: 'Invalid browsing data kind' };
    }
    const partitions = await collectBrowserPartitions();
    return { success: await browserWebContentsRegistry.clearBrowsingData(kind, partitions) };
  },
});

// Every persistent profile partition (default + named) plus any partitions with
// live sessions, so clearing browsing data covers isolated-per-task tabs too.
async function collectBrowserPartitions(): Promise<string[]> {
  const browserSettings = await appSettingsService.get('browser');
  const partitions = new Set<string>([browserProfilePartition(DEFAULT_BROWSER_PROFILE_ID)]);
  for (const profile of browserSettings.profiles) {
    partitions.add(browserProfilePartition(profile.id));
  }
  for (const partition of browserWebContentsRegistry.registeredPartitions) {
    partitions.add(partition);
  }
  return [...partitions];
}
