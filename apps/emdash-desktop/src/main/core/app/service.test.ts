import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  getVersion: vi.fn(() => '1.1.27'),
  homedir: vi.fn(() => 'C:\\Users\\Jan'),
  realpath: vi.fn(async (path: string) => path),
  openExternal: vi.fn(),
  openPath: vi.fn(),
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
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    realpath: mocks.realpath,
  };
});

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: mocks.homedir,
  };
});

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
  },
  Menu: {
    buildFromTemplate: mocks.menuBuildFromTemplate,
  },
}));

vi.mock('@main/app/window', () => ({
  getMainWindow: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {},
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
    mocks.homedir.mockReturnValue('C:\\Users\\Jan');
    mocks.realpath.mockImplementation(async (path: string) => path);
    mocks.openPath.mockResolvedValue('');
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

  it('escapes Windows cmd metacharacters in quoted launcher paths', async () => {
    const target = 'C:\\Users\\Qwenzy\\Desktop\\work & notes %USERNAME%^';

    await appService.openIn({ app: 'vscode', path: target });

    expect(mocks.exec).toHaveBeenCalledWith(
      'code "C:\\Users\\Qwenzy\\Desktop\\work ^& notes ^%USERNAME^%^^" || code-insiders "C:\\Users\\Qwenzy\\Desktop\\work ^& notes ^%USERNAME^%^^"',
      expect.objectContaining({ cwd: target }),
      expect.any(Function)
    );
  });

  it('uses cwd instead of nested cd commands for Windows terminal fallback', async () => {
    const target = 'C:\\Users\\Qwenzy\\Desktop\\work & notes %USERNAME%^';

    await appService.openIn({ app: 'terminal', path: target });

    expect(mocks.exec).toHaveBeenCalledWith(
      'wt -d "C:\\Users\\Qwenzy\\Desktop\\work ^& notes ^%USERNAME^%^^" || start "" cmd /K',
      expect.objectContaining({ cwd: target }),
      expect.any(Function)
    );
  });

  it('opens home-relative Windows paths with a backslash after tilde', async () => {
    mocks.realpath.mockImplementation(async (path: string) =>
      path === 'C:\\Users\\Jan' ? 'C:\\Users\\Jan' : 'C:\\Users\\Jan\\notes.txt'
    );

    await appService.openPath('~\\notes.txt');

    expect(mocks.openPath).toHaveBeenCalledWith('C:\\Users\\Jan\\notes.txt');
  });

  it('allows Windows home-contained paths with different drive casing', async () => {
    mocks.realpath.mockImplementation(async (path: string) =>
      path === 'C:\\Users\\Jan' ? 'C:\\Users\\Jan' : 'c:\\Users\\Jan\\notes.txt'
    );

    await appService.openPath('c:\\Users\\Jan\\notes.txt');

    expect(mocks.openPath).toHaveBeenCalledWith('c:\\Users\\Jan\\notes.txt');
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
