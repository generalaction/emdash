import { realpath } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  dbLimit: vi.fn(),
  dbSelect: vi.fn(),
  getVersion: vi.fn(() => '1.1.27'),
  openExternal: vi.fn(),
  openPath: vi.fn(),
  showItemInFolder: vi.fn(),
  menuPopup: vi.fn(),
  menuBuildFromTemplate: vi.fn((template: Electron.MenuItemConstructorOptions[]) => ({
    popup: mocks.menuPopup,
    template,
  })),
  eventEmit: vi.fn(),
  clipboardWriteText: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  exec: mocks.exec,
  execFile: mocks.execFile,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => ''),
    getVersion: mocks.getVersion,
    quit: vi.fn(),
  },
  clipboard: {
    writeText: mocks.clipboardWriteText,
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  shell: {
    openExternal: mocks.openExternal,
    openPath: mocks.openPath,
    showItemInFolder: mocks.showItemInFolder,
  },
  Menu: {
    buildFromTemplate: mocks.menuBuildFromTemplate,
  },
}));

vi.mock('@main/app/window', () => ({
  getMainWindow: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: mocks.dbSelect,
  },
}));

vi.mock('@main/db/schema', () => ({
  sshConnections: {},
}));

vi.mock('@main/lib/events', () => ({
  events: {
    emit: mocks.eventEmit,
    on: vi.fn(() => vi.fn()),
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    error: vi.fn(),
  },
}));

vi.mock('@main/utils/childProcessEnv', () => ({
  buildExternalToolEnv: () => ({}),
}));

const { appService } = await import('./service');

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    ...originalPlatform,
    value: platform,
  });
}

describe('AppService.openIn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPlatform('win32');
    mocks.openPath.mockResolvedValue('');
    mocks.openExternal.mockResolvedValue(undefined);
    mocks.execFile.mockImplementation(
      (_file: string, _args: string[], _options: object, callback: (error: Error | null) => void) =>
        callback(null)
    );
    mocks.dbLimit.mockResolvedValue([
      { id: 'connection-1', host: 'example.com', username: 'alice', port: 22 },
    ]);
    mocks.dbSelect.mockReturnValue({
      from: () => ({
        where: () => ({ limit: mocks.dbLimit }),
      }),
    });
    mocks.exec.mockImplementation(
      (_command: string, _options: object, callback: (error: Error | null) => void) => {
        callback(null);
      }
    );
  });

  afterEach(() => {
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
  });

  it('opens the platform file manager with Electron shell.openPath instead of a shell command', async () => {
    const target = 'C:/Users/Qwenzy/Desktop/ees_ams';

    await appService.openIn({ app: 'finder', path: target });

    expect(mocks.openPath).toHaveBeenCalledWith(target);
    expect(mocks.exec).not.toHaveBeenCalled();
  });

  it('throws when Electron shell.openPath returns an error message', async () => {
    const target = 'C:/Users/Qwenzy/Desktop/missing';
    mocks.openPath.mockResolvedValueOnce('Path does not exist');

    await expect(appService.openIn({ app: 'finder', path: target })).rejects.toThrow(
      'Path does not exist'
    );
    expect(mocks.openPath).toHaveBeenCalledWith(target);
    expect(mocks.exec).not.toHaveBeenCalled();
  });

  it('opens remote VS Code workspaces in a new window via the macOS bundle', async () => {
    setPlatform('darwin');

    await appService.openIn({
      app: 'vscode',
      path: '/repo with space',
      isRemote: true,
      sshConnectionId: 'connection-1',
    });

    expect(mocks.execFile).toHaveBeenCalledTimes(1);
    expect(mocks.execFile.mock.calls[0]?.slice(0, 2)).toEqual([
      'open',
      [
        '-n',
        '-b',
        'com.microsoft.VSCode',
        '--args',
        '--new-window',
        '--remote',
        'ssh-remote+7b22686f73744e616d65223a226578616d706c652e636f6d222c2275736572223a22616c696365227d',
        '/repo with space',
      ],
    ]);
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });

  it('falls back to the registered VS Code URI when command launchers are unavailable', async () => {
    setPlatform('darwin');
    mocks.execFile.mockImplementation(
      (_file: string, _args: string[], _options: object, callback: (error: Error | null) => void) =>
        callback(new Error('not installed'))
    );

    await appService.openIn({
      app: 'vscode',
      path: '/repo',
      isRemote: true,
      sshConnectionId: 'connection-1',
    });

    const vscodeArgs = [
      '--new-window',
      '--remote',
      'ssh-remote+7b22686f73744e616d65223a226578616d706c652e636f6d222c2275736572223a22616c696365227d',
      '/repo',
    ];
    expect(mocks.execFile.mock.calls.map(([file, args]) => [file, args])).toEqual([
      ['open', ['-n', '-b', 'com.microsoft.VSCode', '--args', ...vscodeArgs]],
      ['open', ['-n', '-b', 'com.microsoft.VSCodeInsiders', '--args', ...vscodeArgs]],
      ['open', ['-n', '-a', 'Visual Studio Code', '--args', ...vscodeArgs]],
      ['open', ['-n', '-a', 'Visual Studio Code - Insiders', '--args', ...vscodeArgs]],
    ]);
    expect(mocks.openExternal).toHaveBeenCalledWith(
      'vscode://vscode-remote/ssh-remote+7b22686f73744e616d65223a226578616d706c652e636f6d222c2275736572223a22616c696365227d/repo'
    );
  });

  it('keeps other remote editor launches on their registered URI', async () => {
    setPlatform('darwin');

    await appService.openIn({
      app: 'vscodium',
      path: '/repo',
      isRemote: true,
      sshConnectionId: 'connection-1',
    });

    expect(mocks.execFile).not.toHaveBeenCalled();
    expect(mocks.openExternal).toHaveBeenCalledWith(
      'vscodium://vscode-remote/ssh-remote+7b22686f73744e616d65223a226578616d706c652e636f6d222c2275736572223a22616c696365227d/repo'
    );
  });
});

describe('AppService.showItemInFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reveals the resolved path with Electron shell.showItemInFolder', async () => {
    await appService.showItemInFolder(homedir());

    expect(mocks.showItemInFolder).toHaveBeenCalledWith(await realpath(homedir()));
  });

  it('rejects paths outside the user home directory', async () => {
    await expect(appService.showItemInFolder(tmpdir())).rejects.toThrow(
      'Path must be inside the user home directory'
    );
    expect(mocks.showItemInFolder).not.toHaveBeenCalled();
  });
});

describe('AppService.showTerminalContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('copies the exact selected terminal text without trimming whitespace', () => {
    appService.showTerminalContextMenu({
      requestId: 'request-1',
      selectionText: '  indented value\n',
      x: 10,
      y: 20,
    });

    const template = mocks.menuBuildFromTemplate.mock.calls[0]?.[0];
    const copyItem = template?.find((item) => item.label === 'Copy');

    expect(copyItem?.enabled).toBe(true);
    copyItem?.click?.({} as Electron.MenuItem, undefined as never, undefined as never);

    expect(mocks.clipboardWriteText).toHaveBeenCalledWith('  indented value\n');
  });

  it('allows copying whitespace-only selections', () => {
    appService.showTerminalContextMenu({
      requestId: 'request-1',
      selectionText: '   ',
      x: 10,
      y: 20,
    });

    const template = mocks.menuBuildFromTemplate.mock.calls[0]?.[0];
    const copyItem = template?.find((item) => item.label === 'Copy');

    expect(copyItem?.enabled).toBe(true);
    copyItem?.click?.({} as Electron.MenuItem, undefined as never, undefined as never);

    expect(mocks.clipboardWriteText).toHaveBeenCalledWith('   ');
  });
});
