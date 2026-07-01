import path from 'node:path';
import type { IFileSystem } from '@emdash/core/files';
import { ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { IFilesRuntime } from '@main/core/runtime/types';
import { CursorTrustService } from './cursor-trust-service';

const mockAccess = vi.hoisted(() => vi.fn());
const mockMkdir = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockWarn = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  promises: {
    access: mockAccess,
    mkdir: mockMkdir,
    writeFile: mockWriteFile,
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

function nodeNotFound() {
  return Object.assign(new Error('not found'), { code: 'ENOENT' });
}

function makeService(overrides: { autoTrustWorktrees?: boolean } = {}): CursorTrustService {
  return new CursorTrustService({
    getTaskSettings: () =>
      Promise.resolve({ autoTrustWorktrees: overrides.autoTrustWorktrees ?? true }),
  });
}

function makeRemoteFs(
  overrides: Partial<Pick<IFileSystem, 'realPath' | 'exists' | 'writeText'>> = {}
): Pick<IFileSystem, 'realPath' | 'exists' | 'writeText'> {
  return {
    realPath: vi.fn(async () => ok('/remote/worktree')),
    exists: vi.fn(async () => ok(false)),
    writeText: vi.fn(async (_path: string, content: string) =>
      ok({ bytesWritten: content.length })
    ),
    ...overrides,
  };
}

function makeFilesRuntime(args: {
  fs: Pick<IFileSystem, 'realPath' | 'exists' | 'writeText'>;
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

function makeCtx(): IExecutionContext {
  return {
    root: undefined,
    supportsLocalSpawn: false,
    exec: vi.fn().mockImplementation(async (command: string) => {
      if (command === 'sh') return { stdout: '/home/remote-user', stderr: '' };
      return { stdout: '', stderr: '' };
    }),
    execStreaming: vi.fn(),
    dispose: vi.fn(),
  };
}

describe('CursorTrustService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockRejectedValue(nodeNotFound());
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('skips non-Cursor providers', async () => {
    const service = makeService();

    await service.maybeAutoTrustLocal({
      providerId: 'claude',
      workspacePath: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('skips when auto-trust is disabled', async () => {
    const service = makeService({ autoTrustWorktrees: false });

    await service.maybeAutoTrustLocal({
      providerId: 'cursor',
      workspacePath: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('trusts Cursor workspaces when forced even if auto-trust is disabled', async () => {
    const service = makeService({ autoTrustWorktrees: false });

    await service.maybeAutoTrustLocal({
      providerId: 'cursor',
      workspacePath: '/tmp/worktree',
      homedir: '/home/local-user',
      force: true,
    });

    expect(mockAccess).toHaveBeenCalledWith(
      '/home/local-user/.cursor/projects/tmp-worktree/.workspace-trusted'
    );
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });

  it('writes the local Cursor workspace trust marker when missing', async () => {
    const service = makeService();

    await service.maybeAutoTrustLocal({
      providerId: 'cursor',
      workspacePath: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    const markerPath = '/home/local-user/.cursor/projects/tmp-worktree/.workspace-trusted';
    expect(mockAccess).toHaveBeenCalledWith(markerPath);
    expect(mockMkdir).toHaveBeenCalledWith('/home/local-user/.cursor/projects/tmp-worktree', {
      recursive: true,
    });
    expect(mockWriteFile).toHaveBeenCalledWith(markerPath, expect.any(String), 'utf8');

    const marker = JSON.parse(String(mockWriteFile.mock.calls[0][1]));
    expect(marker).toEqual({
      trustedAt: expect.any(String),
      workspacePath: '/tmp/worktree',
      trustMethod: 'emdash-auto-trust',
    });
  });

  it('refuses to auto-trust relative local workspace paths', async () => {
    const service = makeService();

    await service.maybeAutoTrustLocal({
      providerId: 'cursor',
      workspacePath: './relative/path',
      homedir: '/home/local-user',
    });

    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledWith(
      'CursorTrustService: refusing to auto-trust non-absolute workspace path',
      { path: './relative/path' }
    );
  });

  it('is idempotent when the local marker already exists', async () => {
    const service = makeService();
    mockAccess.mockResolvedValue(undefined);

    await service.maybeAutoTrustLocal({
      providerId: 'cursor',
      workspacePath: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    expect(mockMkdir).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('matches Cursor CLI workspace trust directory derivation for long workspace paths', async () => {
    const service = makeService();

    await service.maybeAutoTrustLocal({
      providerId: 'cursor',
      workspacePath: '/Users/janburzinski/emdash/worktrees/emdash-official/tough-falcons-notice',
      homedir: '/Users/janburzinski',
    });

    expect(mockWriteFile).toHaveBeenCalledWith(
      '/Users/janburzinski/.cursor/projects/Users-janburzinski-emdash-worktrees-emdash-official-tough-falcons-notice/.workspace-trusted',
      expect.any(String),
      'utf8'
    );
  });

  it('writes the ssh Cursor workspace trust marker remotely', async () => {
    const service = makeService();
    const remoteFs = makeRemoteFs({
      realPath: vi.fn(async () => ok('/remote/worktree')),
    });
    const files = makeFilesRuntime({ fs: remoteFs });
    const ctx = makeCtx();

    await service.maybeAutoTrustSsh({
      providerId: 'cursor',
      workspacePath: '/remote/worktree',
      ctx,
      files,
    });

    const markerPath = '/home/remote-user/.cursor/projects/remote-worktree/.workspace-trusted';
    expect(remoteFs.exists).toHaveBeenCalledWith(markerPath);
    expect(remoteFs.writeText).toHaveBeenCalledWith(markerPath, expect.any(String));

    const marker = JSON.parse(String(vi.mocked(remoteFs.writeText).mock.calls[0][1]));
    expect(marker).toEqual({
      trustedAt: expect.any(String),
      workspacePath: '/remote/worktree',
      trustMethod: 'emdash-auto-trust',
    });
  });

  it('refuses to auto-trust relative ssh workspace paths', async () => {
    const service = makeService();
    const remoteFs = makeRemoteFs();
    const files = makeFilesRuntime({ fs: remoteFs });
    const ctx = makeCtx();

    await service.maybeAutoTrustSsh({
      providerId: 'cursor',
      workspacePath: 'relative/worktree',
      ctx,
      files,
    });

    expect(remoteFs.realPath).not.toHaveBeenCalled();
    expect(remoteFs.exists).not.toHaveBeenCalled();
    expect(remoteFs.writeText).not.toHaveBeenCalled();
    expect(ctx.exec).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledWith(
      'CursorTrustService: refusing to auto-trust non-absolute workspace path',
      { path: 'relative/worktree' }
    );
  });
});
