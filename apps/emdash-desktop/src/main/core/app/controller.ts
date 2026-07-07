import { execFile } from 'node:child_process';
import { arch, release } from 'node:os';
import { promisify } from 'node:util';
import { getDiagnosticLogAttachment } from '@main/lib/file-logger';
import { telemetryService } from '@main/lib/telemetry';
import { createRPCController } from '@shared/lib/ipc/rpc';
import type { OpenInAppId } from '@shared/openInApps';
import { appService } from './service';

const execFileAsync = promisify(execFile);

async function getPlatformDisplayName(): Promise<string> {
  const architecture = arch();

  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('sw_vers', ['-productVersion']);
      const macOsVersion = stdout.trim();
      if (macOsVersion) return `macOS ${macOsVersion} (${architecture})`;
    } catch {
      // Fall back to the Darwin kernel version when sw_vers is unavailable.
    }
    return `macOS ${release()} (${architecture})`;
  }

  if (process.platform === 'win32') {
    return `Windows ${release()} (${architecture})`;
  }

  if (process.platform === 'linux') {
    return `Linux ${release()} (${architecture})`;
  }

  return `${process.platform} ${release()} (${architecture})`;
}

export const appController = createRPCController({
  openExternal: async (url: string) => {
    try {
      await appService.openExternal(url);
      telemetryService.capture('open_in_external', { app: 'browser' });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  openPath: async (path: string) => {
    try {
      await appService.openPath(path);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  readUserFile: async (path: string) => {
    try {
      const result = await appService.readUserFile(path);
      return { success: true as const, ...result };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
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
  showTerminalContextMenu: async (args: {
    requestId: string;
    selectionText?: string | null;
    linkText?: string | null;
    x: number;
    y: number;
  }) => {
    try {
      appService.showTerminalContextMenu(args);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  quit: () => {
    try {
      appService.quit();
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
      telemetryService.capture('open_in_external', { app: args.app });
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
  openSelectAudioFileDialog: (args: { title: string; message: string }) =>
    appService.openSelectAudioFileDialog(args),
  saveTextFile: async (args: { title: string; defaultPath: string; content: string }) => {
    try {
      return { success: true as const, path: await appService.saveTextFile(args) };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
  readAudioFileDataUrl: async (filePath: string) => {
    try {
      return { success: true, dataUrl: await appService.readAudioFileDataUrl(filePath) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  minimizeWindow: () => {
    appService.minimizeWindow();
    return { success: true };
  },
  toggleMaximizeWindow: () => {
    appService.toggleMaximizeWindow();
    return { success: true };
  },
  closeWindow: () => {
    appService.closeWindow();
    return { success: true };
  },
  isWindowMaximized: () => appService.isWindowMaximized(),
  getAppVersion: () => appService.getCachedAppVersion(),
  getElectronVersion: () => process.versions.electron,
  getPlatform: () => process.platform,
  getPlatformDisplayName,
  getDiagnosticLogAttachment,
});
