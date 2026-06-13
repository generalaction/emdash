import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import {
  FileSystemError,
  FileSystemErrorCodes,
  type FileSystemProvider,
} from '@main/core/fs/types';
import { PiTrustService } from './pi-trust-service';

const mockReadFile = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockMkdir = vi.hoisted(() => vi.fn());
const mockRename = vi.hoisted(() => vi.fn());
const mockRm = vi.hoisted(() => vi.fn());
const mockRealpath = vi.hoisted(() => vi.fn());
const mockWarn = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  promises: {
    readFile: mockReadFile,
    writeFile: mockWriteFile,
    mkdir: mockMkdir,
    rename: mockRename,
    rm: mockRm,
    realpath: mockRealpath,
  },
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: { get: vi.fn() },
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    warn: mockWarn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function notFound(pathName: string): FileSystemError {
  return new FileSystemError(
    `File not found: ${pathName}`,
    FileSystemErrorCodes.NOT_FOUND,
    pathName
  );
}

function makeService(overrides: { autoTrustWorktrees?: boolean } = {}): PiTrustService {
  return new PiTrustService({
    getTaskSettings: () =>
      Promise.resolve({ autoTrustWorktrees: overrides.autoTrustWorktrees ?? true }),
  });
}

function makeRemoteFs(
  overrides: Partial<Pick<FileSystemProvider, 'realPath' | 'read' | 'write'>> = {}
): Pick<FileSystemProvider, 'realPath' | 'read' | 'write'> {
  return {
    realPath: vi.fn(async (p: string) => p),
    read: vi.fn().mockRejectedValue(notFound('/home/remote-user/.pi/agent/trust.json')),
    write: vi.fn().mockResolvedValue({ success: true, bytesWritten: 0 }),
    ...overrides,
  };
}

describe('PiTrustService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
    mockRealpath.mockImplementation(async (p: string) => p);
  });

  it('skips providers without Pi trust config', async () => {
    const service = makeService();

    await service.maybeAutoTrustLocal({
      providerId: 'claude',
      cwd: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('skips when auto-trust is disabled', async () => {
    const service = makeService({ autoTrustWorktrees: false });

    await service.maybeAutoTrustLocal({
      providerId: 'pi',
      cwd: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('trusts Pi worktrees when forced even if auto-trust is disabled', async () => {
    const service = makeService({ autoTrustWorktrees: false });

    await service.maybeAutoTrustLocal({
      providerId: 'pi',
      cwd: '/tmp/worktree',
      homedir: '/home/local-user',
      force: true,
    });

    expect(mockReadFile).toHaveBeenCalledWith('/home/local-user/.pi/agent/trust.json', 'utf8');
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });

  it('writes local Pi trust config atomically when missing', async () => {
    const service = makeService();

    await service.maybeAutoTrustLocal({
      providerId: 'pi',
      cwd: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    expect(mockMkdir).toHaveBeenCalledWith('/home/local-user/.pi/agent', { recursive: true });
    const [tmpPath, content] = mockWriteFile.mock.calls[0];
    const [renameFrom, renameTo] = mockRename.mock.calls[0];
    expect(tmpPath).toContain('/home/local-user/.pi/agent/trust.json.');
    expect(tmpPath).toContain('.tmp');
    expect(renameFrom).toBe(tmpPath);
    expect(renameTo).toBe('/home/local-user/.pi/agent/trust.json');
    expect(JSON.parse(String(content))).toEqual({ '/tmp/worktree': true });
  });

  it('trusts the canonical local path for symlinked worktrees', async () => {
    const service = makeService();
    mockRealpath.mockResolvedValue('/private/tmp/real-worktree');

    await service.maybeAutoTrustLocal({
      providerId: 'pi',
      cwd: '/tmp/symlinked-worktree',
      homedir: '/home/local-user',
    });

    expect(mockRealpath).toHaveBeenCalledWith('/tmp/symlinked-worktree');
    const [, content] = mockWriteFile.mock.calls[0];
    expect(JSON.parse(String(content))).toEqual({ '/private/tmp/real-worktree': true });
  });

  it('falls back to the resolved local path when canonicalization fails', async () => {
    const service = makeService();
    mockRealpath.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));

    await service.maybeAutoTrustLocal({
      providerId: 'pi',
      cwd: '/tmp/missing-worktree',
      homedir: '/home/local-user',
    });

    const [, content] = mockWriteFile.mock.calls[0];
    expect(JSON.parse(String(content))).toEqual({ '/tmp/missing-worktree': true });
  });

  it('preserves existing trust decisions and sorts paths', async () => {
    const service = makeService();
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        '/z': false,
        '/a': null,
      })
    );

    await service.maybeAutoTrustLocal({
      providerId: 'pi',
      cwd: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    const [, content] = mockWriteFile.mock.calls[0];
    expect(String(content)).toBe(
      JSON.stringify(
        {
          '/a': null,
          '/tmp/worktree': true,
          '/z': false,
        },
        null,
        2
      ) + '\n'
    );
  });

  it('does not rewrite Pi trust config when folder is already trusted', async () => {
    const service = makeService();
    mockReadFile.mockResolvedValue(JSON.stringify({ '/tmp/worktree': true }));

    await service.maybeAutoTrustLocal({
      providerId: 'pi',
      cwd: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('refuses to overwrite invalid Pi trust values', async () => {
    const service = makeService();
    mockReadFile.mockResolvedValue(JSON.stringify({ '/tmp/worktree': 'yes' }));

    await service.maybeAutoTrustLocal({
      providerId: 'pi',
      cwd: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledWith(
      'PiTrustService: refusing to overwrite invalid Pi trust config value',
      { key: '/tmp/worktree' }
    );
  });

  it('writes ssh Pi trust config and renames tmp file remotely', async () => {
    const service = makeService();
    const remoteFs = makeRemoteFs({
      realPath: vi.fn().mockResolvedValue('/remote/worktree'),
    });

    const ctx: IExecutionContext = {
      root: undefined,
      supportsLocalSpawn: false,
      exec: vi.fn().mockImplementation(async (command: string, args: string[] = []) => {
        if (command === 'sh') {
          return { stdout: '/home/remote-user', stderr: '' };
        }
        if (command === 'mv') {
          expect(args[0]).toContain('/home/remote-user/.pi/agent/trust.json.');
          expect(args[1]).toBe('/home/remote-user/.pi/agent/trust.json');
          return { stdout: '', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      }),
      execStreaming: vi.fn(),
      dispose: vi.fn(),
    };

    await service.maybeAutoTrustSsh({
      providerId: 'pi',
      cwd: '/remote/worktree',
      ctx,
      remoteFs,
    });

    expect(remoteFs.read).toHaveBeenCalledWith(
      '/home/remote-user/.pi/agent/trust.json',
      expect.any(Number)
    );
    const [tmpPath, content] = vi.mocked(remoteFs.write).mock.calls[0];
    expect(tmpPath).toContain('/home/remote-user/.pi/agent/trust.json.');
    expect(JSON.parse(String(content))).toEqual({ '/remote/worktree': true });
    expect(ctx.exec).toHaveBeenCalledWith('mv', [
      tmpPath,
      '/home/remote-user/.pi/agent/trust.json',
    ]);
  });
});
