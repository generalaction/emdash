import { webContents } from 'electron';
import { configureBrowserProfileSession } from '@main/core/browser/browser-profile-session';
import { browserWebContentsRegistry } from '@main/core/browser/browser-webcontents-registry';
import { isBrowserPartition } from '@main/core/browser/webview-security';
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

  clearStorage: async (browserId: string) => ({
    success: await browserWebContentsRegistry.clearStorage(browserId),
  }),
});
