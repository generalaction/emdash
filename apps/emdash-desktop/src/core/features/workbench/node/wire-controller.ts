import { createController, type Controller } from '@emdash/wire/api';
import { appOperations } from '@main/core/app/controller';
import { desktopHostContract } from '../api';
import { desktopHostEvents } from './event-host';

export function createDesktopHostWireController(): Controller {
  return createController(desktopHostContract, {
    openExternal: ({ url }) => appOperations.openExternal(url),
    openPath: ({ path }) => appOperations.openPath(path),
    readUserFile: ({ path }) => appOperations.readUserFile(path),
    writeRendererLog: (input) => appOperations.writeRendererLog(input),
    clipboardWriteText: ({ text }) => appOperations.clipboardWriteText(text),
    showWorkspaceItemInFolder: (input) => appOperations.showWorkspaceItemInFolder(input),
    persistDroppedBlob: (input) => appOperations.persistDroppedBlob(input),
    persistClipboardImage: () => appOperations.persistClipboardImage(),
    showTerminalContextMenu: (input) => appOperations.showTerminalContextMenu(input),
    quit: () => appOperations.quit(),
    openIn: (input) => appOperations.openIn(input),
    checkInstalledApps: () => appOperations.checkInstalledApps(),
    listInstalledFonts: (input) => appOperations.listInstalledFonts(input),
    openSelectDirectoryDialog: (input) => appOperations.openSelectDirectoryDialog(input),
    openSelectAudioFileDialog: (input) => appOperations.openSelectAudioFileDialog(input),
    saveTextFile: (input) => appOperations.saveTextFile(input),
    readAudioFileDataUrl: ({ filePath }) => appOperations.readAudioFileDataUrl(filePath),
    minimizeWindow: () => appOperations.minimizeWindow(),
    toggleMaximizeWindow: () => appOperations.toggleMaximizeWindow(),
    closeWindow: () => appOperations.closeWindow(),
    isWindowMaximized: () => appOperations.isWindowMaximized(),
    getAppVersion: () => appOperations.getAppVersion(),
    getElectronVersion: () => appOperations.getElectronVersion(),
    getPlatform: () => appOperations.getPlatform(),
    getPlatformDisplayName: () => appOperations.getPlatformDisplayName(),
    getDiagnosticLogAttachment: () => appOperations.getDiagnosticLogAttachment(),
    events: desktopHostEvents,
  });
}
