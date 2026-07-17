import { getDesktopWireClient } from './desktop-wire-client';

async function host() {
  return (await getDesktopWireClient()).host;
}

export const rpc = {
  app: {
    openExternal: (url: string) => host().then((client) => client.openExternal({ url })),
    openPath: (path: string) => host().then((client) => client.openPath({ path })),
    readUserFile: (path: string) => host().then((client) => client.readUserFile({ path })),
    clipboardWriteText: (text: string) =>
      host().then((client) => client.clipboardWriteText({ text })),
    showWorkspaceItemInFolder: (input: { workspaceId: string; relativePath: string }) =>
      host().then((client) => client.showWorkspaceItemInFolder(input)),
    persistDroppedBlob: (input: { bytes: Uint8Array; name?: string; mimeType?: string }) =>
      host().then((client) => client.persistDroppedBlob(input)),
    persistClipboardImage: () => host().then((client) => client.persistClipboardImage()),
    showTerminalContextMenu: (input: {
      requestId: string;
      selectionText?: string | null;
      linkText?: string | null;
      x: number;
      y: number;
    }) => host().then((client) => client.showTerminalContextMenu(input)),
    quit: () => host().then((client) => client.quit()),
    openIn: (input: Parameters<Awaited<ReturnType<typeof host>>['openIn']>[0]) =>
      host().then((client) => client.openIn(input)),
    checkInstalledApps: () => host().then((client) => client.checkInstalledApps()),
    listInstalledFonts: (input: { refresh?: boolean } = {}) =>
      host().then((client) => client.listInstalledFonts(input)),
    openSelectDirectoryDialog: (
      input: Parameters<Awaited<ReturnType<typeof host>>['openSelectDirectoryDialog']>[0]
    ) => host().then((client) => client.openSelectDirectoryDialog(input)),
    openSelectAudioFileDialog: (
      input: Parameters<Awaited<ReturnType<typeof host>>['openSelectAudioFileDialog']>[0]
    ) => host().then((client) => client.openSelectAudioFileDialog(input)),
    saveTextFile: (input: Parameters<Awaited<ReturnType<typeof host>>['saveTextFile']>[0]) =>
      host().then((client) => client.saveTextFile(input)),
    readAudioFileDataUrl: (filePath: string) =>
      host().then((client) => client.readAudioFileDataUrl({ filePath })),
    minimizeWindow: () => host().then((client) => client.minimizeWindow()),
    toggleMaximizeWindow: () => host().then((client) => client.toggleMaximizeWindow()),
    closeWindow: () => host().then((client) => client.closeWindow()),
    isWindowMaximized: () => host().then((client) => client.isWindowMaximized()),
    getAppVersion: () => host().then((client) => client.getAppVersion()),
    getElectronVersion: () => host().then((client) => client.getElectronVersion()),
    getPlatform: () => host().then((client) => client.getPlatform()),
    getPlatformDisplayName: () => host().then((client) => client.getPlatformDisplayName()),
    getDiagnosticLogAttachment: () => host().then((client) => client.getDiagnosticLogAttachment()),
  },
};
