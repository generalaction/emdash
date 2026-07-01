import path from 'node:path';
import type { IFileSystem } from '@emdash/core/files';
import { err, ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { IFilesRuntime } from '@main/core/runtime/types';
import { ClaudeTrustService } from './claude-trust-service';

const mockReadFile = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockMkdir = vi.hoisted(() => vi.fn());
const mockRename = vi.hoisted(() => vi.fn());
const mockRm = vi.hoisted(() => vi.fn());
const mockWarn = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  promises: {
    readFile: mockReadFile,
    writeFile: mockWriteFile,
    mkdir: mockMkdir,
    rename: mockRename,
    rm: mockRm,
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

function makeService(overrides: { autoTrustWorktrees?: boolean } = {}): ClaudeTrustService {
  return new ClaudeTrustService({
    getTaskSettings: () =>
      Promise.resolve({ autoTrustWorktrees: overrides.autoTrustWorktrees ?? true }),
  });
}

function makeRemoteFs(
  overrides: Partial<Pick<IFileSystem, 'realPath' | 'readText' | 'writeText'>> = {}
): Pick<IFileSystem, 'realPath' | 'readText' | 'writeText'> {
  return {
    realPath: vi.fn(async () => ok('/remote/worktree')),
    readText: vi.fn(async (p: string) =>
      err({
        type: 'fs-error' as const,
        path: p,
        message: `File not found: ${p}`,
        code: 'NOT_FOUND',
      })
    ),
    writeText: vi.fn(async (_path: string, content: string) =>
      ok({ bytesWritten: content.length })
    ),
    ...overrides,
  };
}

function makeFilesRuntime(args: {
  fs: Pick<IFileSystem, 'realPath' | 'readText' | 'writeText'>;
}): IFilesRuntime {
  return {
    path: {
      join: (...parts: string[]) => path.posix.join(...parts),
      dirname: (value: string) => path.posix.dirname(value),
      basename: (value: string) => path.posix.basename(value),
      isAbsolute: (value: string) => path.posix.isAbsolute(value),
      relative: (from: string, to: string) => path.posix.relative(from, to),
      contains: (parent: string, child: string) => {
        const rel = path.posix.relative(parent, child);
        return (
          rel === '' || (rel !== '..' && !rel.startsWith('../') && !path.posix.isAbsolute(rel))
        );
      },
    },
    openTree: vi.fn(),
    watchChanges: vi.fn(),
    fileSystem: vi.fn(() => ok(args.fs as IFileSystem)),
    dispose: vi.fn(),
  } as unknown as IFilesRuntime;
}

describe('ClaudeTrustService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
  });

  it('skips providers without trust config', async () => {
    const service = makeService();

    await service.maybeAutoTrustLocal({
      providerId: 'codex',
      workspacePath: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('skips when auto-trust is disabled', async () => {
    const service = makeService({ autoTrustWorktrees: false });

    await service.maybeAutoTrustLocal({
      providerId: 'claude',
      workspacePath: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('trusts Claude worktrees when forced even if auto-trust is disabled', async () => {
    const service = makeService({ autoTrustWorktrees: false });

    await service.maybeAutoTrustLocal({
      providerId: 'claude',
      workspacePath: '/tmp/worktree',
      homedir: '/home/local-user',
      force: true,
    });

    expect(mockReadFile).toHaveBeenCalledWith('/home/local-user/.claude.json', 'utf8');
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });

  it('writes local config atomically when missing', async () => {
    const service = makeService();
    const workspacePath = '/absolute/path';

    await service.maybeAutoTrustLocal({
      providerId: 'claude',
      workspacePath,
      homedir: '/home/local-user',
    });

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockMkdir).toHaveBeenCalledWith('/home/local-user', { recursive: true });
    expect(mockRename).toHaveBeenCalledTimes(1);

    const [tmpPath, content] = mockWriteFile.mock.calls[0];
    const [renameFrom, renameTo] = mockRename.mock.calls[0];
    expect(tmpPath).toContain('/home/local-user/.claude.json.');
    expect(tmpPath).toContain('.tmp');
    expect(renameFrom).toBe(tmpPath);
    expect(renameTo).toBe('/home/local-user/.claude.json');

    const written = JSON.parse(String(content));
    expect(written.projects[workspacePath]).toEqual({
      hasTrustDialogAccepted: true,
      hasCompletedProjectOnboarding: true,
    });
  });

  it('refuses to auto-trust relative local workspace paths', async () => {
    const service = makeService();

    await service.maybeAutoTrustLocal({
      providerId: 'claude',
      workspacePath: './relative/path',
      homedir: '/home/local-user',
    });

    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledWith(
      'ClaudeTrustService: refusing to auto-trust non-absolute workspace path',
      { path: './relative/path' }
    );
  });

  it('adds Copilot trusted folders', async () => {
    const service = makeService();
    mockReadFile.mockResolvedValue(JSON.stringify({ trustedFolders: ['/already/trusted'] }));

    await service.maybeAutoTrustLocal({
      providerId: 'copilot',
      workspacePath: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    expect(mockMkdir).toHaveBeenCalledWith('/home/local-user/.copilot', { recursive: true });
    const [tmpPath, content] = mockWriteFile.mock.calls[0];
    const [renameFrom, renameTo] = mockRename.mock.calls[0];
    expect(tmpPath).toContain('/home/local-user/.copilot/config.json.');
    expect(renameFrom).toBe(tmpPath);
    expect(renameTo).toBe('/home/local-user/.copilot/config.json');
    expect(JSON.parse(String(content)).trustedFolders).toEqual([
      '/already/trusted',
      '/tmp/worktree',
    ]);
  });

  it('does not rewrite Copilot config when folder is already trusted', async () => {
    const service = makeService();
    mockReadFile.mockResolvedValue(JSON.stringify({ trustedFolders: ['/tmp/worktree'] }));

    await service.maybeAutoTrustLocal({
      providerId: 'copilot',
      workspacePath: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('is idempotent when already trusted', async () => {
    const service = makeService();
    const trustedPath = '/already/trusted';
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        projects: {
          [trustedPath]: {
            hasTrustDialogAccepted: true,
            hasCompletedProjectOnboarding: true,
          },
        },
      })
    );

    await service.maybeAutoTrustLocal({
      providerId: 'claude',
      workspacePath: trustedPath,
      homedir: '/home/local-user',
    });

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('refuses to overwrite corrupt JSON and logs a warning', async () => {
    const service = makeService();
    mockReadFile.mockResolvedValue('{ invalid json');

    await service.maybeAutoTrustLocal({
      providerId: 'claude',
      workspacePath: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockRename).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledWith(
      'ClaudeTrustService: refusing to overwrite corrupt Claude config',
      expect.objectContaining({ error: expect.any(String) })
    );
  });

  it('refuses to overwrite non-object config root', async () => {
    const service = makeService();
    mockReadFile.mockResolvedValue(JSON.stringify([1, 2, 3]));

    await service.maybeAutoTrustLocal({
      providerId: 'claude',
      workspacePath: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledWith(
      'ClaudeTrustService: refusing to overwrite non-object Claude config root'
    );
  });

  it('serializes concurrent calls so no trust entry is lost', async () => {
    const service = makeService();
    let callCount = 0;

    mockReadFile.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return null;
      const [, content] = mockWriteFile.mock.calls[0];
      return String(content);
    });

    await Promise.all([
      service.maybeAutoTrustLocal({
        providerId: 'claude',
        workspacePath: '/worktree/a',
        homedir: '/home/local-user',
      }),
      service.maybeAutoTrustLocal({
        providerId: 'claude',
        workspacePath: '/worktree/b',
        homedir: '/home/local-user',
      }),
    ]);

    expect(mockWriteFile).toHaveBeenCalledTimes(2);
    const secondWriteContent = JSON.parse(String(mockWriteFile.mock.calls[1][1]));
    expect(secondWriteContent.projects[path.resolve('/worktree/a')]).toEqual({
      hasTrustDialogAccepted: true,
      hasCompletedProjectOnboarding: true,
    });
    expect(secondWriteContent.projects[path.resolve('/worktree/b')]).toEqual({
      hasTrustDialogAccepted: true,
      hasCompletedProjectOnboarding: true,
    });
  });

  it('writes ssh config and renames tmp file remotely', async () => {
    const service = makeService();
    const remoteFs = makeRemoteFs({
      realPath: vi.fn(async () => ok('/remote/worktree')),
    });
    const files = makeFilesRuntime({ fs: remoteFs });

    const ctx: IExecutionContext = {
      root: undefined,
      supportsLocalSpawn: false,
      exec: vi.fn().mockImplementation(async (command: string, args: string[] = []) => {
        if (command === 'sh') {
          return { stdout: '/home/remote-user', stderr: '' };
        }
        if (command === 'mv') {
          expect(args[0]).toContain('/home/remote-user/.claude.json.');
          expect(args[1]).toBe('/home/remote-user/.claude.json');
          return { stdout: '', stderr: '' };
        }
        if (command === 'mkdir') {
          return { stdout: '', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      }),
      execStreaming: vi.fn(),
      dispose: vi.fn(),
    };

    await service.maybeAutoTrustSsh({
      providerId: 'claude',
      workspacePath: '/remote/worktree',
      ctx,
      files,
    });

    expect(remoteFs.readText).toHaveBeenCalledWith('/home/remote-user/.claude.json', {
      maxBytes: expect.any(Number),
    });
    expect(remoteFs.writeText).toHaveBeenCalledTimes(1);
    const [tmpPath, content] = vi.mocked(remoteFs.writeText).mock.calls[0];
    expect(tmpPath).toContain('/home/remote-user/.claude.json.');
    const written = JSON.parse(String(content));
    expect(written.projects['/remote/worktree']).toEqual({
      hasTrustDialogAccepted: true,
      hasCompletedProjectOnboarding: true,
    });
    expect(ctx.exec).toHaveBeenCalledWith('mv', [tmpPath, '/home/remote-user/.claude.json']);
  });

  it('refuses to auto-trust relative ssh workspace paths', async () => {
    const service = makeService();
    const remoteFs = makeRemoteFs();
    const files = makeFilesRuntime({ fs: remoteFs });
    const ctx: IExecutionContext = {
      root: undefined,
      supportsLocalSpawn: false,
      exec: vi.fn(),
      execStreaming: vi.fn(),
      dispose: vi.fn(),
    };

    await service.maybeAutoTrustSsh({
      providerId: 'claude',
      workspacePath: 'relative/worktree',
      ctx,
      files,
    });

    expect(remoteFs.realPath).not.toHaveBeenCalled();
    expect(remoteFs.writeText).not.toHaveBeenCalled();
    expect(ctx.exec).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledWith(
      'ClaudeTrustService: refusing to auto-trust non-absolute workspace path',
      { path: 'relative/worktree' }
    );
  });
});
