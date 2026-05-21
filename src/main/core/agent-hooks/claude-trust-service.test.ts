import path from 'node:path';
import * as jsonc from 'jsonc-parser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import {
  FileSystemError,
  FileSystemErrorCodes,
  type FileSystemProvider,
} from '@main/core/fs/types';
import { ClaudeTrustService } from './claude-trust-service';

const mockReadFile = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockRename = vi.hoisted(() => vi.fn());
const mockRm = vi.hoisted(() => vi.fn());
const mockMkdir = vi.hoisted(() => vi.fn());
const mockWarn = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  promises: {
    readFile: mockReadFile,
    writeFile: mockWriteFile,
    rename: mockRename,
    rm: mockRm,
    mkdir: mockMkdir,
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

function makeService(overrides: { autoTrustWorktrees?: boolean } = {}): ClaudeTrustService {
  return new ClaudeTrustService({
    getTaskSettings: () =>
      Promise.resolve({ autoTrustWorktrees: overrides.autoTrustWorktrees ?? true }),
  });
}

function makeRemoteFs(
  overrides: Partial<Pick<FileSystemProvider, 'realPath' | 'read' | 'write'>> = {}
): Pick<FileSystemProvider, 'realPath' | 'read' | 'write'> {
  return {
    realPath: vi.fn(async (p: string) => p),
    read: vi.fn().mockRejectedValue(notFound('/home/remote-user/.claude.json')),
    write: vi.fn().mockResolvedValue({ success: true, bytesWritten: 0 }),
    ...overrides,
  };
}

describe('ClaudeTrustService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
  });

  it('skips providers without directory trust support', async () => {
    const service = makeService();

    await service.maybeAutoTrustLocal({
      providerId: 'opencode',
      cwd: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('skips when auto-trust is disabled', async () => {
    const service = makeService({ autoTrustWorktrees: false });

    await service.maybeAutoTrustLocal({
      providerId: 'claude',
      cwd: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('writes local config atomically when missing', async () => {
    const service = makeService();
    const relPath = './relative/path';

    await service.maybeAutoTrustLocal({
      providerId: 'claude',
      cwd: relPath,
      homedir: '/home/local-user',
    });

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockRename).toHaveBeenCalledTimes(1);

    const [tmpPath, content] = mockWriteFile.mock.calls[0];
    const [renameFrom, renameTo] = mockRename.mock.calls[0];
    expect(tmpPath).toContain('/home/local-user/.claude.json.');
    expect(tmpPath).toContain('.tmp');
    expect(renameFrom).toBe(tmpPath);
    expect(renameTo).toBe('/home/local-user/.claude.json');

    const written = JSON.parse(String(content));
    expect(written.projects[path.resolve(relPath)]).toEqual({
      hasTrustDialogAccepted: true,
      hasCompletedProjectOnboarding: true,
    });
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
      cwd: trustedPath,
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
      cwd: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockRename).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledWith(
      'ProviderTrustService: refusing to overwrite corrupt Claude config',
      expect.objectContaining({ error: expect.any(String) })
    );
  });

  it('refuses to overwrite non-object config root', async () => {
    const service = makeService();
    mockReadFile.mockResolvedValue(JSON.stringify([1, 2, 3]));

    await service.maybeAutoTrustLocal({
      providerId: 'claude',
      cwd: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledWith(
      'ProviderTrustService: refusing to overwrite non-object Claude config root'
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
        cwd: '/worktree/a',
        homedir: '/home/local-user',
      }),
      service.maybeAutoTrustLocal({
        providerId: 'claude',
        cwd: '/worktree/b',
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
          expect(args[0]).toContain('/home/remote-user/.claude.json.');
          expect(args[1]).toBe('/home/remote-user/.claude.json');
          return { stdout: '', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      }),
      execStreaming: vi.fn(),
      dispose: vi.fn(),
    };

    await service.maybeAutoTrustSsh({
      providerId: 'claude',
      cwd: '/remote/worktree',
      ctx,
      remoteFs,
    });

    expect(remoteFs.read).toHaveBeenCalledWith(
      '/home/remote-user/.claude.json',
      expect.any(Number)
    );
    expect(remoteFs.write).toHaveBeenCalledTimes(1);
    const [tmpPath, content] = vi.mocked(remoteFs.write).mock.calls[0];
    expect(tmpPath).toContain('/home/remote-user/.claude.json.');
    const written = JSON.parse(String(content));
    expect(written.projects['/remote/worktree']).toEqual({
      hasTrustDialogAccepted: true,
      hasCompletedProjectOnboarding: true,
    });
    expect(ctx.exec).toHaveBeenCalledWith('mv', [tmpPath, '/home/remote-user/.claude.json']);
  });

  it('adds Copilot trustedFolders entries', async () => {
    const service = makeService();
    mockReadFile.mockResolvedValue(
      `// User settings belong in settings.json.
{
  "theme": "dark",
  "trustedFolders": ["/existing"]
}`
    );

    await service.maybeAutoTrustLocal({
      providerId: 'copilot',
      cwd: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    expect(mockRename.mock.calls[0][1]).toBe('/home/local-user/.copilot/config.json');
    const content = String(mockWriteFile.mock.calls[0][1]);
    expect(content).toContain('// User settings belong in settings.json.');
    const written = jsonc.parse(content);
    expect(written).toEqual({
      theme: 'dark',
      trustedFolders: ['/existing', path.resolve('/tmp/worktree')],
    });
  });

  it('adds Codex trusted project entries', async () => {
    const service = makeService();
    mockReadFile.mockResolvedValue('model = "gpt-5"\n');

    await service.maybeAutoTrustLocal({
      providerId: 'codex',
      cwd: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    expect(mockRename.mock.calls[0][1]).toBe('/home/local-user/.codex/config.toml');
    expect(String(mockWriteFile.mock.calls[0][1])).toContain('[projects."/tmp/worktree"]');
    expect(String(mockWriteFile.mock.calls[0][1])).toContain('trust_level = "trusted"');
  });

  it('preserves Codex comments and ordering when adding trusted project entries', async () => {
    const service = makeService();
    mockReadFile.mockResolvedValue(`# my custom model
model = "gpt-5"

# keep provider options nearby
[providers.openai]
base_url = "https://api.openai.com/v1"
`);

    await service.maybeAutoTrustLocal({
      providerId: 'codex',
      cwd: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    const content = String(mockWriteFile.mock.calls[0][1]);
    expect(content).toContain('# my custom model');
    expect(content).toContain('# keep provider options nearby');
    expect(content.indexOf('model = "gpt-5"')).toBeLessThan(content.indexOf('[providers.openai]'));
    expect(content).toContain('[projects."/tmp/worktree"]');
    expect(content).toContain('trust_level = "trusted"');
  });

  it('preserves Codex comments when updating an existing project section', async () => {
    const service = makeService();
    mockReadFile.mockResolvedValue(`# top-level comment
[projects."/tmp/worktree"]
# project note
name = "worktree"

[profiles.default]
model = "gpt-5"
`);

    await service.maybeAutoTrustLocal({
      providerId: 'codex',
      cwd: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    const content = String(mockWriteFile.mock.calls[0][1]);
    expect(content).toContain('# top-level comment');
    expect(content).toContain('# project note');
    expect(content).toContain('name = "worktree"');
    expect(content).toContain('trust_level = "trusted"');
    expect(content.indexOf('trust_level = "trusted"')).toBeLessThan(
      content.indexOf('[profiles.default]')
    );
  });

  it('uses CODEX_HOME for local Codex config when set', async () => {
    const service = makeService();
    mockReadFile.mockResolvedValue('model = "gpt-5"\n');

    await service.maybeAutoTrustLocal({
      providerId: 'codex',
      cwd: '/tmp/worktree',
      homedir: '/home/local-user',
      env: { CODEX_HOME: '/custom/codex-home' },
    });

    expect(mockReadFile).toHaveBeenCalledWith('/custom/codex-home/config.toml', 'utf8');
    expect(mockRename.mock.calls[0][1]).toBe('/custom/codex-home/config.toml');
  });

  it('uses CODEX_HOME for ssh Codex config when set', async () => {
    const service = makeService();
    const remoteFs = makeRemoteFs({
      realPath: vi.fn().mockResolvedValue('/remote/worktree'),
      read: vi.fn().mockRejectedValue(notFound('/custom/codex-home/config.toml')),
    });
    const ctx: IExecutionContext = {
      root: undefined,
      supportsLocalSpawn: false,
      exec: vi.fn().mockImplementation(async (command: string) => {
        if (command === 'sh') return { stdout: '/home/remote-user', stderr: '' };
        return { stdout: '', stderr: '' };
      }),
      execStreaming: vi.fn(),
      dispose: vi.fn(),
    };

    await service.maybeAutoTrustSsh({
      providerId: 'codex',
      cwd: '/remote/worktree',
      ctx,
      remoteFs,
      env: { CODEX_HOME: '/custom/codex-home' },
    });

    expect(remoteFs.read).toHaveBeenCalledWith(
      '/custom/codex-home/config.toml',
      expect.any(Number)
    );
    expect(ctx.exec).toHaveBeenCalledWith('mv', [
      expect.stringContaining('/custom/codex-home/config.toml.'),
      '/custom/codex-home/config.toml',
    ]);
  });

  it('uses COPILOT_HOME for local Copilot config when set', async () => {
    const service = makeService();
    mockReadFile.mockResolvedValue(JSON.stringify({ trustedFolders: [] }));

    await service.maybeAutoTrustLocal({
      providerId: 'copilot',
      cwd: '/tmp/worktree',
      homedir: '/home/local-user',
      env: { COPILOT_HOME: '/custom/copilot-home' },
    });

    expect(mockReadFile).toHaveBeenCalledWith('/custom/copilot-home/config.json', 'utf8');
    expect(mockRename.mock.calls[0][1]).toBe('/custom/copilot-home/config.json');
  });
});
