import { beforeEach, describe, expect, it, vi } from 'vitest';

type IpcHandler = (...args: unknown[]) => unknown;

const ipcHandleHandlers = new Map<string, IpcHandler>();
const shellOpenExternalMock = vi.fn<(url: string) => Promise<void>>();
const getSshConnectionMock =
  vi.fn<(id: string) => Promise<{ host: string; username: string; port: number } | null>>();

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getVersion: vi.fn(() => '0.0.0-test'),
    getAppPath: vi.fn(() => process.cwd()),
  },
  BrowserWindow: vi.fn(),
  clipboard: {
    writeText: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn((channel: string, cb: IpcHandler) => {
      ipcHandleHandlers.set(channel, cb);
    }),
    on: vi.fn(),
  },
  shell: {
    openExternal: (url: string) => shellOpenExternalMock(url),
  },
}));

vi.mock('../../main/services/DatabaseService', () => ({
  databaseService: {
    getSshConnection: (id: string) => getSshConnectionMock(id),
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

describe('app:openIn remote workspace handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    ipcHandleHandlers.clear();
  });

  async function getHandler() {
    const { registerAppIpc } = await import('../../main/ipc/appIpc');
    registerAppIpc();
    const handler = ipcHandleHandlers.get('app:openIn');
    expect(handler).toBeTypeOf('function');
    return handler!;
  }

  it('rejects unsupported remote apps before attempting SSH launch', async () => {
    const handler = await getHandler();

    const result = await handler(
      {},
      {
        app: 'zed',
        path: '/srv/repo',
        isRemote: true,
        sshConnectionId: 'ssh-1',
      }
    );

    expect(result).toEqual({
      success: false,
      error: 'Zed is not available for remote SSH workspaces.',
    });
    expect(getSshConnectionMock).not.toHaveBeenCalled();
    expect(shellOpenExternalMock).not.toHaveBeenCalled();
  });

  it('returns a clear error when a supported remote app is missing the SSH connection id', async () => {
    const handler = await getHandler();

    const result = await handler(
      {},
      {
        app: 'vscode',
        path: '/srv/repo',
        isRemote: true,
      }
    );

    expect(result).toEqual({
      success: false,
      error: 'Missing SSH connection for remote VS Code launch.',
    });
    expect(getSshConnectionMock).not.toHaveBeenCalled();
  });

  it('keeps supported remote editor launches working', async () => {
    const handler = await getHandler();

    getSshConnectionMock.mockResolvedValue({
      host: 'example.internal',
      username: 'azureuser',
      port: 22,
    });
    shellOpenExternalMock.mockResolvedValue(undefined);

    const result = await handler(
      {},
      {
        app: 'vscode',
        path: '/srv/repo',
        isRemote: true,
        sshConnectionId: 'ssh-1',
      }
    );

    expect(result).toEqual({ success: true });
    expect(getSshConnectionMock).toHaveBeenCalledWith('ssh-1');
    expect(shellOpenExternalMock).toHaveBeenCalledWith(
      'vscode://vscode-remote/ssh-remote+azureuser%40example.internal/srv/repo'
    );
  });
});
