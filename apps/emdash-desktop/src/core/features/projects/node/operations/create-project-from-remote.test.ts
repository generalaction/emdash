import { hostRef } from '@emdash/core/primitives/host/api';
import { ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hostPathFromNative } from '@core/primitives/desktop-runtime/api';
import { createProjectFromRemote } from './create-project-from-remote';

const mocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  runRuntimeLiveJob: vi.fn(),
}));

vi.mock('./create-project', () => ({
  createProject: mocks.createProject,
}));

vi.mock('@core/services/runtime-clients/node/live-job', () => ({
  runRuntimeLiveJob: mocks.runRuntimeLiveJob,
}));

describe('createProjectFromRemote', () => {
  const exists = vi.fn();
  const stat = vi.fn();
  const enumerate = {};
  const deleteMutation = vi.fn();
  const cloneRepository = {};
  const client = vi.fn();

  const dependencies = {
    db: {} as never,
    runtimes: { client },
    projects: { openProject: vi.fn() },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    exists.mockResolvedValue(ok(false));
    stat.mockResolvedValue(ok({ type: 'directory' }));
    deleteMutation.mockResolvedValue(ok());
    client.mockResolvedValue(
      ok({
        files: {
          fs: { exists, stat, enumerate },
          mutations: { delete: deleteMutation },
        },
        git: { cloneRepository },
      })
    );
    mocks.runRuntimeLiveJob.mockResolvedValue(ok({ path: hostPathFromNative('/remote/repo') }));
    mocks.createProject.mockResolvedValue(
      ok({
        type: 'ssh',
        id: 'project-1',
        name: 'repo',
        path: '/remote/repo',
        baseRef: 'main',
        connectionId: 'ssh-1',
        repositoryWorkspaceId: null,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      })
    );
  });

  it('clones and registers against the SSH host runtime', async () => {
    const progress = vi.fn();
    const publish = vi.fn();
    const result = await createProjectFromRemote(
      dependencies,
      {
        projectId: 'project-1',
        host: { type: 'ssh', connectionId: 'ssh-1' },
        mode: 'clone',
        repositoryUrl: 'https://github.com/acme/repo.git',
        targetPath: '/remote/repo',
        name: 'repo',
      },
      { signal: new AbortController().signal, progress } as never,
      publish
    );

    expect(client).toHaveBeenCalledWith(hostRef('remote', 'ssh-1'));
    expect(exists).toHaveBeenCalledWith({
      root: hostPathFromNative('/remote'),
      relative: 'repo',
    });
    expect(mocks.runRuntimeLiveJob).toHaveBeenCalledWith(
      expect.anything(),
      cloneRepository,
      expect.objectContaining({
        repositoryUrl: 'https://github.com/acme/repo.git',
        targetPath: hostPathFromNative('/remote/repo'),
      }),
      expect.any(Function),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(mocks.runRuntimeLiveJob.mock.calls[0]?.[2]).toEqual({
      repositoryUrl: 'https://github.com/acme/repo.git',
      targetPath: hostPathFromNative('/remote/repo'),
      initialize: undefined,
    });
    expect(mocks.createProject).toHaveBeenCalledWith(dependencies, {
      type: 'ssh',
      id: 'project-1',
      name: 'repo',
      path: '/remote/repo',
      connectionId: 'ssh-1',
    });
    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({ type: 'ssh', connectionId: 'ssh-1' }),
    });
    expect(publish).toHaveBeenCalledWith('project-1', expect.objectContaining({ phase: 'ready' }));
  });
});
