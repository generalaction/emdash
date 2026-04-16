import { createRPCController } from '@shared/ipc/rpc';
import type { OpenInAppId } from '@shared/openInApps';
import { capture } from '@main/lib/telemetry';
import { appService } from './service';

export const appController = createRPCController({
  openExternal: async (url: string) => {
    try {
      await appService.openExternal(url);
      capture('open_in_external', { app: 'browser' });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  clipboardWriteText: async (text: string) => {
    try {
      appService.clipboardWriteText(text);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  openIn: async (args: {
    app: OpenInAppId;
    path: string;
    isRemote?: boolean;
    sshConnectionId?: string | null;
  }) => {
    try {
      await appService.openIn(args);
      capture('open_in_external', { app: args.app });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  checkInstalledApps: () => appService.checkInstalledApps(),
  listInstalledFonts: async (args?: { refresh?: boolean }) => {
    const { fonts, cached, error } = await appService.listInstalledFonts(args?.refresh);
    return { success: !error, fonts, cached, ...(error ? { error } : {}) };
  },
  openSelectDirectoryDialog: (args: { title: string; message: string; defaultPath?: string }) =>
    appService.openSelectDirectoryDialog(args),
  getAppVersion: () => appService.getCachedAppVersion(),
  getElectronVersion: () => process.versions.electron,
  getPlatform: () => process.platform,
});
