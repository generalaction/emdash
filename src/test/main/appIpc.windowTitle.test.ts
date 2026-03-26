import { beforeEach, describe, expect, it, vi } from 'vitest';

type IpcHandler = (...args: unknown[]) => unknown;

const ipcHandleHandlers = new Map<string, IpcHandler>();
const setTitleMock = vi.fn<(title: string) => void>();
const fromWebContentsMock = vi.fn<(webContents: unknown) => { setTitle: typeof setTitleMock }>(
  () => ({
    setTitle: setTitleMock,
  })
);

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getVersion: vi.fn(() => '0.0.0-test'),
    getAppPath: vi.fn(() => process.cwd()),
  },
  BrowserWindow: {
    fromWebContents: (webContents: unknown) => fromWebContentsMock(webContents),
  },
  clipboard: {
    writeText: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn((channel: string, cb: IpcHandler) => {
      ipcHandleHandlers.set(channel, cb);
    }),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

vi.mock('../../main/services/DatabaseService', () => ({
  databaseService: {
    getSshConnection: vi.fn(),
  },
}));

vi.mock('../../main/services/ProjectPrep', () => ({
  ensureProjectPrepared: vi.fn(),
}));

vi.mock('../../main/settings', () => ({
  getAppSettings: vi.fn(() => ({
    projectPrep: {
      autoInstallOnOpenInEditor: false,
    },
  })),
}));

vi.mock('../../main/utils/childProcessEnv', () => ({
  buildExternalToolEnv: vi.fn(() => process.env),
}));

describe('app:setWindowTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    ipcHandleHandlers.clear();
  });

  async function getHandler() {
    const { registerAppIpc } = await import('../../main/ipc/appIpc');
    registerAppIpc();
    const handler = ipcHandleHandlers.get('app:setWindowTitle');
    expect(handler).toBeTypeOf('function');
    return handler!;
  }

  it('updates the BrowserWindow title for the sender window', async () => {
    const handler = await getHandler();
    const sender = { id: 1 };

    const result = await handler({ sender }, 'repo-name • feature/window-title');

    expect(result).toEqual({ success: true });
    expect(fromWebContentsMock).toHaveBeenCalledWith(sender);
    expect(setTitleMock).toHaveBeenCalledWith('repo-name • feature/window-title');
  });

  it('rejects non-string titles', async () => {
    const handler = await getHandler();

    const result = await handler({ sender: {} }, 42);

    expect(result).toEqual({ success: false, error: 'Invalid window title' });
    expect(setTitleMock).not.toHaveBeenCalled();
  });
});
