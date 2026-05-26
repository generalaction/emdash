import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import {
  FileSystemError,
  FileSystemErrorCodes,
  type FileSystemProvider,
} from '@main/core/fs/types';
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

function fsNotFound(pathName: string): FileSystemError {
  return new FileSystemError(
    `File not found: ${pathName}`,
    FileSystemErrorCodes.NOT_FOUND,
    pathName
  );
}

function makeService(overrides: { autoTrustWorktrees?: boolean } = {}): CursorTrustService {
  return new CursorTrustService({
    getTaskSettings: () =>
      Promise.resolve({ autoTrustWorktrees: overrides.autoTrustWorktrees ?? true }),
  });
}

function makeRemoteFs(
  overrides: Partial<Pick<FileSystemProvider, 'realPath' | 'read' | 'write'>> = {}
): Pick<FileSystemProvider, 'realPath' | 'read' | 'write'> {
  return {
    realPath: vi.fn(async (p: string) => p),
    read: vi.fn().mockRejectedValue(fsNotFound('/home/remote-user/.cursor/projects/worktree')),
    write: vi.fn().mockResolvedValue({ success: true, bytesWritten: 0 }),
    ...overrides,
  };
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
      cwd: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('skips when auto-trust is disabled', async () => {
    const service = makeService({ autoTrustWorktrees: false });

    await service.maybeAutoTrustLocal({
      providerId: 'cursor',
      cwd: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('writes the local Cursor workspace trust marker when missing', async () => {
    const service = makeService();

    await service.maybeAutoTrustLocal({
      providerId: 'cursor',
      cwd: '/tmp/worktree',
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

  it('is idempotent when the local marker already exists', async () => {
    const service = makeService();
    mockAccess.mockResolvedValue(undefined);

    await service.maybeAutoTrustLocal({
      providerId: 'cursor',
      cwd: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    expect(mockMkdir).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('matches Cursor CLI project directory hashing for long workspace paths', async () => {
    const service = makeService();

    await service.maybeAutoTrustLocal({
      providerId: 'cursor',
      cwd: '/Users/janburzinski/emdash/worktrees/emdash-official/tough-falcons-notice',
      homedir: '/Users/janburzinski',
    });

    expect(mockWriteFile).toHaveBeenCalledWith(
      '/Users/janburzinski/.cursor/projects/Users-janburzinski-emdash-worktrees-emdash-offi-4eb6c5b/.workspace-trusted',
      expect.any(String),
      'utf8'
    );
  });

  it('writes the ssh Cursor workspace trust marker remotely', async () => {
    const service = makeService();
    const remoteFs = makeRemoteFs({
      realPath: vi.fn().mockResolvedValue('/remote/worktree'),
    });
    const ctx = makeCtx();

    await service.maybeAutoTrustSsh({
      providerId: 'cursor',
      cwd: '/remote/worktree',
      ctx,
      remoteFs,
    });

    const markerPath = '/home/remote-user/.cursor/projects/remote-worktree/.workspace-trusted';
    expect(remoteFs.read).toHaveBeenCalledWith(markerPath, expect.any(Number));
    expect(remoteFs.write).toHaveBeenCalledWith(markerPath, expect.any(String));

    const marker = JSON.parse(String(vi.mocked(remoteFs.write).mock.calls[0][1]));
    expect(marker).toEqual({
      trustedAt: expect.any(String),
      workspacePath: '/remote/worktree',
      trustMethod: 'emdash-auto-trust',
    });
  });
});
