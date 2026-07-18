import path from 'node:path';
import type { ITrustBehavior } from '@emdash/core/agents/plugins';
import type { FileError, IFileSystem } from '@emdash/core/files';
import type { AgentProviderId } from '@emdash/plugins/agents';
import { err, ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { IFilesRuntime } from '@main/core/runtime/types';
import { WorkspaceTrustService } from './workspace-trust';

const mockWarn = vi.hoisted(() => vi.fn());

vi.mock('@main/lib/logger', () => ({
  log: {
    warn: mockWarn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mocked so importing the module (which wires the singleton) stays free of
// DB and plugin-registry side effects; tests construct their own instances.
vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: { get: vi.fn() },
}));

vi.mock('./plugin-registry', () => ({
  getPlugin: vi.fn(() => ({ behavior: {} })),
}));

function makeService(overrides: {
  getTaskSettings?: () => Promise<{ autoTrustWorktrees: boolean }>;
  getTrustBehavior?: (providerId: AgentProviderId) => ITrustBehavior | undefined;
}): WorkspaceTrustService {
  return new WorkspaceTrustService({
    getTaskSettings: overrides.getTaskSettings ?? vi.fn(async () => ({ autoTrustWorktrees: true })),
    getTrustBehavior:
      overrides.getTrustBehavior ??
      vi.fn(() => ({
        trustWorkspace: vi.fn(async () => {}),
      })),
  });
}

function makeCtx(): IExecutionContext {
  return {
    root: undefined,
    supportsLocalSpawn: false,
    // resolveRemoteHome runs `sh -c 'printf %s "$HOME"'` through this.
    exec: vi.fn(async (cmd: string) =>
      cmd === 'sh' ? { stdout: '/home/remote-user', stderr: '' } : { stdout: '', stderr: '' }
    ),
    execStreaming: vi.fn(),
    dispose: vi.fn(),
  } as unknown as IExecutionContext;
}

function makeFilesRuntime(
  fs: Partial<IFileSystem>,
  fileSystem: IFilesRuntime['fileSystem'] = vi.fn(() => ok(fs as unknown as IFileSystem))
) {
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
    fileSystem,
    dispose: vi.fn(),
  } as unknown as IFilesRuntime;
}

describe('WorkspaceTrustService', () => {
  it('skips when auto-trust is disabled', async () => {
    const trustWorkspace = vi.fn();
    const service = makeService({
      getTaskSettings: vi.fn(async () => ({ autoTrustWorktrees: false })),
      getTrustBehavior: vi.fn(() => ({ trustWorkspace })),
    });

    await service.maybeAutoTrust({
      providerId: 'claude',
      workspacePath: '/tmp/worktree',
      host: { kind: 'local', homedir: '/home/local-user' },
    });

    expect(trustWorkspace).not.toHaveBeenCalled();
  });

  it('trusts when forced even if auto-trust is disabled', async () => {
    const trustWorkspace = vi.fn();
    const getTaskSettings = vi.fn(async () => ({ autoTrustWorktrees: false }));
    const service = makeService({
      getTaskSettings,
      getTrustBehavior: vi.fn(() => ({ trustWorkspace })),
    });

    await service.maybeAutoTrust({
      providerId: 'claude',
      workspacePath: '/tmp/worktree',
      host: { kind: 'local', homedir: '/home/local-user' },
      force: true,
    });

    expect(getTaskSettings).not.toHaveBeenCalled();
    expect(trustWorkspace).toHaveBeenCalledWith(expect.any(Object), {
      workspacePath: path.normalize('/tmp/worktree'),
    });
  });

  it('no-ops when the provider has no trust behavior', async () => {
    const getTaskSettings = vi.fn(async () => ({ autoTrustWorktrees: true }));
    const service = makeService({
      getTaskSettings,
      getTrustBehavior: vi.fn(() => undefined),
    });

    await service.maybeAutoTrust({
      providerId: 'claude',
      workspacePath: '/tmp/worktree',
      host: { kind: 'local', homedir: '/home/local-user' },
    });

    expect(getTaskSettings).not.toHaveBeenCalled();
  });

  it('refuses non-absolute workspace paths', async () => {
    const trustWorkspace = vi.fn();
    const service = makeService({
      getTrustBehavior: vi.fn(() => ({ trustWorkspace })),
    });

    await service.maybeAutoTrust({
      providerId: 'claude',
      workspacePath: 'relative/worktree',
      host: { kind: 'local', homedir: '/home/local-user' },
    });

    expect(trustWorkspace).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledWith(
      'WorkspaceTrust: refusing to auto-trust non-absolute workspace path',
      { path: 'relative/worktree' }
    );
  });

  it('logs and swallows trust behavior failures', async () => {
    const service = makeService({
      getTrustBehavior: vi.fn(() => ({
        trustWorkspace: vi.fn(async () => {
          throw new Error('boom');
        }),
      })),
    });

    await service.maybeAutoTrust({
      providerId: 'claude',
      workspacePath: '/tmp/worktree',
      host: { kind: 'local', homedir: '/home/local-user' },
    });

    expect(mockWarn).toHaveBeenCalledWith('WorkspaceTrust: failed to auto-trust worktree', {
      providerId: 'claude',
      path: path.normalize('/tmp/worktree'),
      error: 'Error: boom',
    });
  });

  it('logs a specific warning when the SSH filesystem cannot be opened', async () => {
    const trustWorkspace = vi.fn();
    const fileSystem: IFilesRuntime['fileSystem'] = vi.fn(() =>
      err({
        type: 'fs-error',
        path: '/remote/worktree',
        message: 'connection closed',
      } satisfies FileError)
    );
    const files = makeFilesRuntime({}, fileSystem);
    const service = makeService({
      getTrustBehavior: vi.fn(() => ({ trustWorkspace })),
    });

    await service.maybeAutoTrust({
      providerId: 'claude',
      workspacePath: '/remote/worktree',
      host: { kind: 'ssh', ctx: makeCtx(), files },
    });

    expect(fileSystem).toHaveBeenCalledTimes(1);
    expect(trustWorkspace).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledWith(
      'WorkspaceTrust: failed to open filesystem for workspace trust',
      {
        path: '/remote/worktree',
        error: 'connection closed',
      }
    );
  });

  it('writes SSH config atomically through the remote PluginFs', async () => {
    const behavior: ITrustBehavior = {
      trustWorkspace: async (fs, ctx) => {
        await fs.write(
          '.claude.json',
          JSON.stringify({
            projects: {
              [ctx.workspacePath]: {
                hasTrustDialogAccepted: true,
                hasCompletedProjectOnboarding: true,
              },
            },
          })
        );
      },
    };
    const remoteFs = {
      realPath: vi.fn(async () => ok('/remote/worktree')),
      writeText: vi.fn(async (_value: string, content: string) =>
        ok({ bytesWritten: content.length })
      ),
    };
    const fileSystem: IFilesRuntime['fileSystem'] = vi.fn(() =>
      ok(remoteFs as unknown as IFileSystem)
    );
    const files = makeFilesRuntime(remoteFs, fileSystem);
    const ctx = makeCtx();
    const service = makeService({
      getTrustBehavior: vi.fn(() => behavior),
    });

    await service.maybeAutoTrust({
      providerId: 'claude',
      workspacePath: '/remote/worktree',
      host: { kind: 'ssh', ctx, files },
    });

    expect(fileSystem).toHaveBeenCalledTimes(1);
    expect(remoteFs.writeText).toHaveBeenCalledTimes(1);
    const [tmpPath, content] = remoteFs.writeText.mock.calls[0];
    expect(tmpPath).toContain('/home/remote-user/.claude.json.');
    expect(tmpPath).toContain('.tmp');
    expect(JSON.parse(String(content)).projects['/remote/worktree']).toEqual({
      hasTrustDialogAccepted: true,
      hasCompletedProjectOnboarding: true,
    });
    expect(ctx.exec).toHaveBeenCalledWith('mkdir', ['-p', '/home/remote-user']);
    expect(ctx.exec).toHaveBeenCalledWith('mv', [tmpPath, '/home/remote-user/.claude.json']);
  });
});
