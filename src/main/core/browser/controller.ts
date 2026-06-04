import { browserWebContentsRegistry } from '@main/core/browser/browser-webcontents-registry';
import { isBrowserPartition } from '@main/core/browser/webview-security';
import { createRPCController } from '@shared/ipc/rpc';

export const browserController = createRPCController({
  registerSession: (args: { browserId: string; partition: string }) => {
    if (!args.browserId.trim() || !isBrowserPartition(args.partition)) {
      return { success: false as const, error: 'Invalid browser session' };
    }
    browserWebContentsRegistry.registerSession(args);
    return { success: true as const };
  },

  unregisterSession: (browserId: string) => {
    browserWebContentsRegistry.unregisterSession(browserId);
    return { success: true as const };
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
