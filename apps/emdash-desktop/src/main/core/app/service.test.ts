import type * as ChildProcess from 'node:child_process';
import type { ExecFileOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LOCAL_HOST_REF, hostRef } from '@emdash/core/primitives/host/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hostFileRefFromNativePath,
  hostPathFromNative,
} from '@core/primitives/desktop-runtime/api';
import { OPEN_IN_APPS } from '@core/primitives/open-in-apps/api/open-in-apps';
import { log } from '@main/lib/logger';
import { createInstalledAppDetector } from './installed-apps';

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  spawn: vi.fn(),
  launchEnv: {} as NodeJS.ProcessEnv,
  getVersion: vi.fn(() => '1.1.27'),
  openExternal: vi.fn(),
  openPath: vi.fn(),
  showItemInFolder: vi.fn(),
  workspaceGet: vi.fn(),
  filesRealPath: vi.fn(),
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
  spawn: mocks.spawn,
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

vi.mock('@main/host/window', () => ({
  getMainWindow: vi.fn(),
}));

vi.mock('@main/gateway/workspace-runtime', () => ({
  acquireDesktopWorkspaceRuntime: (workspaceId: string) => mocks.workspaceGet(workspaceId),
}));

vi.mock('@core/services/app-db/node/schema', () => ({
  sshConnections: {},
}));

vi.mock('@main/host/events', () => ({
  events: {
    emit: mocks.eventEmit,
    on: vi.fn(() => vi.fn()),
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@main/lib/childProcessEnv', () => ({
  buildExternalToolEnv: () => mocks.launchEnv,
}));

const { appService } = await import('./service');
appService.initialize({
  acquireWorkspaceRuntime: mocks.workspaceGet,
  emitHostEvent: mocks.eventEmit,
});

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
    mocks.launchEnv = {};
    mocks.openPath.mockResolvedValue('');
    mocks.exec.mockImplementation(
      (_command: string, _options: object, callback: (error: Error | null) => void) => {
        callback(null);
      }
    );
    mocks.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
      setTimeout(() => child.emit('spawn'), 0);
      return child;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
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
    expect(log.warn).toHaveBeenCalledWith(
      '[open-in] Launch failed',
      expect.objectContaining({ appId: 'finder', platform: 'win32', error: 'Path does not exist' })
    );
  });

  it.each([
    { platform: 'win32', appId: 'visual-studio', appPath: 'D:\\VS Preview\\devenv.exe' },
    { platform: 'darwin', appId: 'android-studio-canary', appPath: "/Apps/Canary '$(literal).app" },
  ] as const)(
    'detects and launches $appId through the same slow lookup',
    async ({ platform, appId, appPath }) => {
      vi.useFakeTimers();
      setPlatform(platform);
      mocks.launchEnv = { 'pRoGrAmFiLeS(x86)': 'D:\\Programs' };
      mocks.execFile.mockImplementation(
        (
          file: string,
          _args: string[],
          options: ExecFileOptions,
          callback: (error: Error | null, stdout: string) => void
        ) => {
          if (file === '/usr/bin/osascript') {
            callback(null, JSON.stringify({ [appId]: false }));
          } else if (file === '/usr/bin/open') {
            callback(null, '');
          } else {
            const timeout = options.timeout ?? Infinity;
            setTimeout(
              () =>
                callback(
                  timeout < 29_000 ? new Error('timed out') : null,
                  `${appPath}\r\n/second/result\r\n`
                ),
              Math.min(timeout, 29_000)
            );
          }
        }
      );
      const detector = createInstalledAppDetector({
        platform,
        apps: [OPEN_IN_APPS[appId]],
        resolveEnv: async () => mocks.launchEnv,
      });
      const detection = detector.check();
      await vi.advanceTimersByTimeAsync(29_000);
      expect(await detection).toEqual({ [appId]: 'detected' });

      const target = "/workspace/a '$(literal)";
      const launch = appService.openIn({ app: appId, path: target });
      await vi.advanceTimersByTimeAsync(29_001);
      await launch;

      const lookupFile =
        platform === 'win32'
          ? 'D:\\Programs\\Microsoft Visual Studio\\Installer\\vswhere.exe'
          : '/usr/bin/mdfind';
      const lookupCalls = mocks.execFile.mock.calls.filter(([file]) => file === lookupFile);
      expect(lookupCalls).toHaveLength(2);
      for (const [, args, options] of lookupCalls) {
        expect(args).toEqual(
          platform === 'win32'
            ? ['-latest', '-property', 'productPath']
            : [OPEN_IN_APPS['android-studio-canary'].platforms.darwin!.mdfindQuery]
        );
        expect(options).toMatchObject({
          env: mocks.launchEnv,
          timeout: 30_000,
          killSignal: 'SIGKILL',
        });
        expect(options.signal).toBeInstanceOf(AbortSignal);
      }
      if (platform === 'win32') {
        expect(mocks.spawn).toHaveBeenCalledWith(appPath, [target], expect.any(Object));
      } else {
        expect(mocks.execFile).toHaveBeenCalledWith(
          '/usr/bin/open',
          ['-a', appPath, target],
          expect.any(Object),
          expect.any(Function)
        );
      }
      expect(mocks.exec).not.toHaveBeenCalled();
      detector.dispose();
    }
  );

  it.each(['empty', 'timeout', 'open failure'] as const)(
    'falls back to Android Studio Preview after a Spotlight %s',
    async (outcome) => {
      setPlatform('darwin');
      mocks.execFile.mockImplementation(
        (
          file: string,
          _args: string[],
          _options: ExecFileOptions,
          callback: (error: Error | null, stdout: string) => void
        ) => {
          if (file === '/usr/bin/open' || outcome === 'timeout') callback(new Error('failed'), '');
          else callback(null, outcome === 'empty' ? '' : '/Apps/Canary.app\n');
        }
      );
      await appService.openIn({ app: 'android-studio-canary', path: '/workspace' });
      expect(mocks.exec).toHaveBeenCalledWith(
        'open -a "Android Studio Preview" \'/workspace\'',
        expect.any(Object),
        expect.any(Function)
      );
      expect(mocks.execFile.mock.calls.filter(([file]) => file === '/usr/bin/mdfind')).toHaveLength(
        1
      );
    }
  );

  it.skipIf(process.platform === 'win32')(
    'opens the default Linux terminal through the shell fallback chain',
    async () => {
      setPlatform('linux');
      const { exec } = await vi.importActual<typeof ChildProcess>('node:child_process');
      mocks.exec.mockImplementation(exec);
      const bin = await realpath(await mkdtemp(path.join(os.tmpdir(), 'emdash-open-in-terminal-')));
      const launched = path.join(bin, 'launched.log');
      for (const name of ['xdg-terminal-exec', 'user-terminal']) {
        await writeFile(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${launched}"\n`, {
          mode: 0o755,
        });
      }
      mocks.launchEnv = { PATH: `${bin}:/usr/bin:/bin`, TERMINAL: path.join(bin, 'user-terminal') };

      try {
        await appService.openIn({ app: 'terminal', path: bin });
        expect(await readFile(launched, 'utf8')).toBe(`xdg-terminal-exec --dir=${bin}\n`);

        await rm(launched);
        await rm(path.join(bin, 'xdg-terminal-exec'));
        await appService.openIn({ app: 'terminal', path: bin });
        expect(await readFile(launched, 'utf8')).toBe('user-terminal \n');
      } finally {
        await rm(bin, { recursive: true, force: true });
      }
    }
  );

  it('falls back to devenv on PATH when vswhere is missing', async () => {
    mocks.execFile.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: ExecFileOptions,
        callback: (error: Error | null, stdout: string) => void
      ) => {
        callback(Object.assign(new Error('missing'), { code: 'ENOENT' }), '');
      }
    );
    await appService.openIn({ app: 'visual-studio', path: 'C:/workspace' });
    expect(mocks.exec).toHaveBeenCalledWith(
      'start "" devenv "C:/workspace"',
      expect.any(Object),
      expect.any(Function)
    );
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});

describe('AppService.openPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens a typed local path outside the home directory without URL string building', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'emdash-open-path-'));
    const filePath = path.join(directory, 'report #100%-資料.pdf');
    try {
      await writeFile(filePath, 'test');
      mocks.openPath.mockResolvedValue('');

      await appService.openPath(hostFileRefFromNativePath(filePath));

      expect(mocks.openPath).toHaveBeenCalledWith(await realpath(filePath));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects a remote file identity before touching the desktop OS', async () => {
    await expect(
      appService.openPath(hostFileRefFromNativePath('/tmp/report.pdf', 'ssh-1'))
    ).rejects.toThrow('only available for local files');
    expect(mocks.openPath).not.toHaveBeenCalled();
  });
});

describe('AppService.showWorkspaceItemInFolder', () => {
  const workspaceRoot = hostPathFromNative('/workspace');

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workspaceGet.mockReturnValue({
      identity: { host: LOCAL_HOST_REF },
      files: {
        root: workspaceRoot,
        client: { fs: { realPath: mocks.filesRealPath } },
      },
      release: vi.fn(),
    });
  });

  it('resolves and reveals a path through the workspace files runtime', async () => {
    const resolvedPath = hostPathFromNative('/workspace/reports/summary.md');
    mocks.filesRealPath.mockResolvedValue({ success: true, data: { path: resolvedPath } });

    const result = await appService.showWorkspaceItemInFolder({
      workspaceId: 'workspace-1',
      relativePath: 'reports/summary.md',
    });

    expect(result).toEqual({ success: true, data: undefined });
    expect(mocks.workspaceGet).toHaveBeenCalledWith('workspace-1');
    expect(mocks.filesRealPath).toHaveBeenCalledWith({
      path: hostPathFromNative('/workspace/reports/summary.md'),
    });
    expect(mocks.showItemInFolder).toHaveBeenCalledWith('/workspace/reports/summary.md');
  });

  it('returns a typed error for paths that are not relative to the workspace', async () => {
    const result = await appService.showWorkspaceItemInFolder({
      workspaceId: 'workspace-1',
      relativePath: '/etc/passwd',
    });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'invalid-path',
        path: '/etc/passwd',
        message: 'Path must be relative',
      },
    });
    expect(mocks.filesRealPath).not.toHaveBeenCalled();
    expect(mocks.showItemInFolder).not.toHaveBeenCalled();
  });

  it('does not reveal paths rejected by the workspace files runtime', async () => {
    mocks.filesRealPath.mockResolvedValue({
      success: false,
      error: {
        type: 'invalid-path',
        path: 'outside-link',
        message: 'Path resolves outside the workspace root',
      },
    });

    const result = await appService.showWorkspaceItemInFolder({
      workspaceId: 'workspace-1',
      relativePath: 'outside-link',
    });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'invalid-path',
        path: 'outside-link',
        message: 'Path resolves outside the workspace root',
      },
    });
    expect(mocks.showItemInFolder).not.toHaveBeenCalled();
  });

  it('returns a typed error when the workspace is unavailable', async () => {
    mocks.workspaceGet.mockReturnValue(undefined);

    const result = await appService.showWorkspaceItemInFolder({
      workspaceId: 'missing-workspace',
      relativePath: 'reports/summary.md',
    });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'not_found',
        entity: 'workspace',
        workspaceId: 'missing-workspace',
        message: 'Workspace not found: missing-workspace',
      },
    });
    expect(mocks.filesRealPath).not.toHaveBeenCalled();
    expect(mocks.showItemInFolder).not.toHaveBeenCalled();
  });

  it('returns a typed error without resolving paths for a remote workspace', async () => {
    const remoteHost = hostRef('remote', 'ssh-connection-1');
    mocks.workspaceGet.mockReturnValue({
      identity: { host: remoteHost },
      files: {
        root: workspaceRoot,
        client: { fs: { realPath: mocks.filesRealPath } },
      },
      release: vi.fn(),
    });

    const result = await appService.showWorkspaceItemInFolder({
      workspaceId: 'remote-workspace',
      relativePath: 'reports/summary.md',
    });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'unsupported_host',
        host: remoteHost,
        message: 'Show in file manager is only available for local workspaces',
      },
    });
    expect(mocks.filesRealPath).not.toHaveBeenCalled();
    expect(mocks.showItemInFolder).not.toHaveBeenCalled();
  });

  it('throws unexpected Electron shell failures', async () => {
    const resolvedPath = hostPathFromNative('/workspace/reports/summary.md');
    mocks.filesRealPath.mockResolvedValue({ success: true, data: { path: resolvedPath } });
    mocks.showItemInFolder.mockImplementationOnce(() => {
      throw new Error('Electron shell unavailable');
    });

    await expect(
      appService.showWorkspaceItemInFolder({
        workspaceId: 'workspace-1',
        relativePath: 'reports/summary.md',
      })
    ).rejects.toThrow('Electron shell unavailable');
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
