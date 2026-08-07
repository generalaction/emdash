import { LiveJobCancelledError, LiveJobFailedError } from '@emdash/wire/live';
import type * as WireLive from '@emdash/wire/live';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectCreationProgress } from '@core/features/projects/api';
import {
  createUnregisteredProject,
  createUnmountedProject,
  isUnmountedProject,
  isUnregisteredProject,
  type ProjectStore,
} from '@core/features/projects/api/browser/stores/project';
import { ProjectManagerStore } from '@core/features/projects/api/browser/stores/project-manager';
import type { LocalProject, SshProject } from '@core/primitives/projects/api';

const mocks = vi.hoisted(() => ({
  createGithubRepository: vi.fn(),
  createLiveJobReplicaCache: vi.fn(),
  createProject: vi.fn(),
  deleteGithubRepository: vi.fn(),
  inspectProjectPath: vi.fn(),
  openProject: vi.fn(),
  patchProjectSettings: vi.fn(),
  projectWireCreate: vi.fn(),
  projectWireCancel: vi.fn(),
  projectWireDelete: vi.fn(),
  projectWireProgressCallbacks: [] as Array<(progress: ProjectCreationProgress) => void>,
  projectWireResult: undefined as Promise<LocalProject | SshProject> | undefined,
  resolveRepositoryDestination: vi.fn(),
  deleteMementoSubject: vi.fn(),
  mementoReportError: vi.fn(),
  updateProjectSettings: vi.fn(),
  sshConnect: vi.fn(),
  sshEnsureConnected: vi.fn(),
  sshStateFor: vi.fn(),
}));

vi.mock('@core/features/github/api/browser/client', () => ({
  getGithubClient: async () => ({
    createRepository: mocks.createGithubRepository,
    deleteRepository: mocks.deleteGithubRepository,
  }),
}));

vi.mock('@emdash/wire/live', async (importOriginal) => {
  const actual = await importOriginal<typeof WireLive>();
  return {
    ...actual,
    createLiveJobReplicaCache: mocks.createLiveJobReplicaCache,
  };
});

vi.mock('@core/features/projects/api/browser/client', () => ({
  getProjectsWireClient: async () => ({
    create: {},
    createProject: mocks.createProject,
    delete: mocks.projectWireDelete,
    getProjects: vi.fn(async () => []),
    inspectProjectPath: mocks.inspectProjectPath,
    resolveRepositoryDestination: mocks.resolveRepositoryDestination,
    openProject: mocks.openProject,
    patchProjectSettings: mocks.patchProjectSettings,
    updateProjectSettings: mocks.updateProjectSettings,
  }),
}));

vi.mock('@core/primitives/mementos/browser', () => ({
  getMementoClient: () => ({
    deleteBySubject: mocks.deleteMementoSubject,
    reportError: mocks.mementoReportError,
  }),
}));

vi.mock('@core/primitives/navigation/browser/navigation-selectors', () => ({
  getNavigation: () => ({
    currentViewId: 'home',
    currentRef: { viewId: 'home', params: {}, key: 'home' },
    navigate: vi.fn(),
    invalidateSubject: vi.fn(),
  }),
  getNavigationHistory: () => ({ prune: vi.fn() }),
}));

vi.mock('@core/features/machines/contributions/app-stores', () => ({
  getMachinesStore: () => ({
    connect: mocks.sshConnect,
    ensureConnected: mocks.sshEnsureConnected,
    stateFor: mocks.sshStateFor,
  }),
}));

vi.mock('@core/features/conversations/browser/acp/acp-chat-store', () => ({
  AcpChatStore: class {
    conversationId = '';
    dispose() {}
    bootstrap() {}
  },
}));

vi.mock('@core/features/conversations/browser/acp/acp-chat-panel', () => ({
  AcpChatPanel: () => null,
}));

vi.mock('@core/primitives/telemetry/browser/telemetry-client', () => ({
  captureTelemetry: vi.fn(),
}));

function localProject(overrides: Partial<LocalProject> = {}): LocalProject {
  return {
    type: 'local',
    id: 'project-id',
    name: 'Project',
    path: '/project',
    baseRef: 'main',
    repositoryWorkspaceId: null,
    createdAt: '2026-05-28T00:00:00.000Z',
    updatedAt: '2026-05-28T00:00:00.000Z',
    ...overrides,
  };
}

function sshProject(overrides: Partial<SshProject> = {}): SshProject {
  return {
    type: 'ssh',
    id: 'ssh-project-id',
    name: 'SSH Project',
    path: '/project',
    baseRef: 'main',
    connectionId: 'ssh-1',
    repositoryWorkspaceId: null,
    createdAt: '2026-05-28T00:00:00.000Z',
    updatedAt: '2026-05-28T00:00:00.000Z',
    ...overrides,
  };
}

function okProject(project: LocalProject) {
  return { success: true as const, data: project };
}

describe('ProjectManagerStore project creation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inspectProjectPath.mockResolvedValue({ isDirectory: true, isGitRepo: true });
    mocks.resolveRepositoryDestination.mockImplementation(
      async ({ chosenDir, name }: { chosenDir: string; name: string }) =>
        ({ success: true, data: `${chosenDir}/${name}` }) as const
    );
    mocks.createProject.mockResolvedValue(okProject(localProject()));
    mocks.openProject.mockReturnValue(new Promise(() => {}));
    mocks.projectWireProgressCallbacks.length = 0;
    mocks.projectWireCancel.mockResolvedValue(undefined);
    mocks.projectWireDelete.mockResolvedValue({ success: true, data: undefined });
    mocks.deleteMementoSubject.mockResolvedValue(1);
    mocks.projectWireResult = undefined;
    mocks.createLiveJobReplicaCache.mockReturnValue({
      start: async (input: {
        projectId: string;
        host: { type: 'local' } | { type: 'ssh'; connectionId: string };
        targetPath: string;
        name: string;
        repositoryUrl: string;
      }) => {
        mocks.projectWireCreate(input);
        return {
          ready: async () => ({
            result:
              mocks.projectWireResult ??
              Promise.resolve(
                input.host.type === 'ssh'
                  ? sshProject({
                      id: input.projectId,
                      name: input.name,
                      path: input.targetPath,
                      connectionId: input.host.connectionId,
                    })
                  : localProject({
                      id: input.projectId,
                      name: input.name,
                      path: input.targetPath,
                    })
              ),
            onProgress: (cb: (progress: ProjectCreationProgress) => void) => {
              mocks.projectWireProgressCallbacks.push(cb);
              return vi.fn();
            },
            cancel: mocks.projectWireCancel,
          }),
          release: async () => {},
        };
      },
      dispose: async () => {},
    });
    mocks.createGithubRepository.mockResolvedValue({
      success: true,
      repoUrl: 'https://github.com/acme/project.git',
      cloneUrl: 'https://github.com/acme/project.git',
      nameWithOwner: 'acme/project',
    });
    mocks.deleteGithubRepository.mockResolvedValue({ success: true });
    mocks.updateProjectSettings.mockResolvedValue({
      success: true,
      data: { githubAccountId: 'github.com:42' },
    });
    mocks.patchProjectSettings.mockResolvedValue({
      success: true,
      data: { githubAccountId: 'github.com:42' },
    });
    mocks.sshConnect.mockResolvedValue(undefined);
    mocks.sshEnsureConnected.mockResolvedValue(undefined);
    mocks.sshStateFor.mockReturnValue('disconnected');
  });

  it('discards project and child task mementos before disposing a deleted project', async () => {
    const manager = new ProjectManagerStore();
    const dispose = vi.fn();
    manager.projects.set('project-id', {
      id: 'project-id',
      mountedProject: {
        get: () => ({
          tasks: new Map([
            ['task-1', {}],
            ['task-2', {}],
          ]),
        }),
        dispose,
      },
    } as unknown as ProjectStore);

    await manager.deleteProject('project-id');

    expect(mocks.deleteMementoSubject.mock.calls.map(([subject]) => subject)).toEqual([
      { kind: 'project', key: 'project-id' },
      { kind: 'task', key: 'task-1' },
      { kind: 'task', key: 'task-2' },
    ]);
    expect(dispose).toHaveBeenCalledOnce();
    manager.dispose();
  });

  it('returns an existing project without starting creation', async () => {
    const existingProject = localProject({ id: 'existing-project' });
    mocks.inspectProjectPath.mockResolvedValueOnce({
      isDirectory: true,
      isGitRepo: true,
      existingProject,
    });
    const store = new ProjectManagerStore();

    const result = await store.startProjectCreation(
      { type: 'local' },
      { mode: 'pick', name: 'Project', path: '/project' },
      { id: 'optimistic-project' }
    );

    expect(result).toEqual({ kind: 'existing', projectId: 'existing-project' });
    expect(mocks.createProject).not.toHaveBeenCalled();
    expect(store.projects.has('optimistic-project')).toBe(false);
    expect(store.pendingCreationIds.has('optimistic-project')).toBe(false);
  });

  it('creates unregistered project state before returning creating', async () => {
    let resolveCreateProject: (project: LocalProject) => void = () => {};
    mocks.createProject.mockReturnValueOnce(
      new Promise<ReturnType<typeof okProject>>((resolve) => {
        resolveCreateProject = (project) => resolve(okProject(project));
      })
    );
    const store = new ProjectManagerStore();

    const result = await store.startProjectCreation(
      { type: 'local' },
      { mode: 'pick', name: 'Project', path: '/project' },
      { id: 'optimistic-project' }
    );

    expect(result.kind).toBe('creating');
    const pendingProject = store.projects.get('optimistic-project');
    expect(pendingProject && isUnregisteredProject(pendingProject)).toBe(true);
    expect(pendingProject?.creation).toEqual({ kind: 'running', stage: 'registering' });
    expect(store.pendingCreationIds.has('optimistic-project')).toBe(true);
    expect(mocks.inspectProjectPath).toHaveBeenCalledTimes(1);

    resolveCreateProject(localProject({ id: 'optimistic-project' }));
    if (result.kind === 'creating') await result.completion;

    expect(mocks.inspectProjectPath).toHaveBeenCalledTimes(1);
    expect(store.pendingCreationIds.has('optimistic-project')).toBe(false);
  });

  it('inspects the final clone path instead of the parent directory', async () => {
    const store = new ProjectManagerStore();

    const result = await store.startProjectCreation(
      { type: 'local' },
      {
        mode: 'clone',
        name: 'child-project',
        path: '/parent',
        repositoryUrl: 'https://github.com/acme/child-project.git',
      },
      { id: 'optimistic-project' }
    );

    if (result.kind === 'creating') void result.completion;
    expect(mocks.inspectProjectPath).toHaveBeenCalledWith({
      type: 'local',
      path: '/parent/child-project',
    });
  });

  it('uses the destination allocated by the main-process placement policy', async () => {
    mocks.resolveRepositoryDestination.mockResolvedValueOnce({
      success: true,
      data: '/parent/child-project-2',
    });
    const store = new ProjectManagerStore();

    const result = await store.startProjectCreation(
      { type: 'local' },
      {
        mode: 'clone',
        name: 'child-project',
        path: '/parent',
        repositoryUrl: 'https://github.com/acme/child-project.git',
      },
      { id: 'optimistic-project' }
    );

    if (result.kind === 'creating') await result.completion;
    expect(mocks.inspectProjectPath).toHaveBeenCalledWith({
      type: 'local',
      path: '/parent/child-project-2',
    });
    expect(mocks.projectWireCreate).toHaveBeenCalledWith(
      expect.objectContaining({ targetPath: '/parent/child-project-2' })
    );
  });

  it('starts the clone job with an SSH host for remote clones', async () => {
    const store = new ProjectManagerStore();

    const result = await store.startProjectCreation(
      { type: 'ssh', connectionId: 'ssh-1' },
      {
        mode: 'clone',
        name: 'child-project',
        path: '/parent',
        repositoryUrl: 'https://github.com/acme/child-project.git',
      },
      { id: 'optimistic-project' }
    );

    expect(result.kind).toBe('creating');
    if (result.kind === 'creating') {
      await expect(result.completion).resolves.toEqual({ success: true });
    }
    expect(mocks.inspectProjectPath).toHaveBeenCalledWith({
      type: 'ssh',
      connectionId: 'ssh-1',
      path: '/parent/child-project',
    });
    expect(mocks.projectWireCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        host: { type: 'ssh', connectionId: 'ssh-1' },
        targetPath: '/parent/child-project',
      })
    );
  });

  it('stores remote creation progress on the pending project', async () => {
    let resolveResult: (project: LocalProject) => void = () => {};
    mocks.projectWireResult = new Promise<LocalProject>((resolve) => {
      resolveResult = resolve;
    });
    const store = new ProjectManagerStore();

    const result = await store.startProjectCreation(
      { type: 'local' },
      {
        mode: 'clone',
        name: 'child-project',
        path: '/parent',
        repositoryUrl: 'https://github.com/acme/child-project.git',
      },
      { id: 'optimistic-project' }
    );

    await vi.waitFor(() => expect(mocks.projectWireProgressCallbacks).toHaveLength(1));

    const progress: ProjectCreationProgress = {
      phase: 'cloning',
      percent: 42,
      message: 'Receiving objects: 42%',
    };
    mocks.projectWireProgressCallbacks[0]?.(progress);

    const pendingProject = store.projects.get('optimistic-project');
    expect(pendingProject && isUnregisteredProject(pendingProject)).toBe(true);
    if (pendingProject && isUnregisteredProject(pendingProject)) {
      expect(pendingProject.creation).toEqual({
        kind: 'running',
        stage: 'cloning',
        progressMessage: 'Receiving objects: 42%',
        progressPercent: 42,
      });
    }

    resolveResult(
      localProject({
        id: 'optimistic-project',
        name: 'child-project',
        path: '/parent/child-project',
      })
    );
    if (result.kind === 'creating') await result.completion;
  });

  it('keeps the first creation failure and its captured stage', () => {
    const project = createUnregisteredProject(
      'optimistic-project',
      'Project',
      { kind: 'running', stage: 'cloning' },
      'clone'
    );

    project.failCreation('Clone failed');
    project.failCreation('Registration failed');

    expect(project.creation).toEqual({
      kind: 'failed',
      stage: 'cloning',
      message: 'Clone failed',
    });
  });

  it('cancels remote creation and removes the pending project', async () => {
    let rejectResult: (error: unknown) => void = () => {};
    mocks.projectWireResult = new Promise<LocalProject>((_, reject) => {
      rejectResult = reject;
    });
    const store = new ProjectManagerStore();

    const result = await store.startProjectCreation(
      { type: 'local' },
      {
        mode: 'clone',
        name: 'child-project',
        path: '/parent',
        repositoryUrl: 'https://github.com/acme/child-project.git',
      },
      { id: 'optimistic-project' }
    );

    await vi.waitFor(() => expect(mocks.projectWireProgressCallbacks).toHaveLength(1));
    store.cancelProjectCreation('optimistic-project');
    rejectResult(new LiveJobCancelledError());

    expect(mocks.projectWireCancel).toHaveBeenCalledOnce();
    if (result.kind === 'creating') {
      await expect(result.completion).resolves.toEqual({
        success: false,
        error: { type: 'cancelled', message: 'Project creation was cancelled' },
      });
    }
    expect(store.projects.has('optimistic-project')).toBe(false);
  });

  it('inspects the final new-project path instead of the parent directory', async () => {
    const store = new ProjectManagerStore();

    const result = await store.startProjectCreation(
      { type: 'local' },
      {
        mode: 'new',
        name: 'child-project',
        path: '/parent',
        repositoryName: 'child-project',
        repositoryOwner: 'acme',
        repositoryVisibility: 'private',
      },
      { id: 'optimistic-project' }
    );

    if (result.kind === 'creating') void result.completion;
    expect(mocks.inspectProjectPath).toHaveBeenCalledWith({
      type: 'local',
      path: '/parent/child-project',
    });
  });

  it('does not let a project registered at the clone parent path short-circuit creation', async () => {
    const parentProject = localProject({ id: 'parent-project', path: '/parent' });
    mocks.inspectProjectPath.mockImplementation(async ({ path }: { path: string }) => ({
      isDirectory: true,
      isGitRepo: true,
      existingProject: path === '/parent' ? parentProject : undefined,
    }));
    const store = new ProjectManagerStore();

    const result = await store.startProjectCreation(
      { type: 'local' },
      {
        mode: 'clone',
        name: 'child-project',
        path: '/parent',
        repositoryUrl: 'https://github.com/acme/child-project.git',
      },
      { id: 'optimistic-project' }
    );

    if (result.kind === 'creating') void result.completion;
    expect(result.kind).toBe('creating');
    expect(store.projects.has('optimistic-project')).toBe(true);
  });

  it('does not let a project registered at the new-project parent path short-circuit creation', async () => {
    const parentProject = localProject({ id: 'parent-project', path: '/parent' });
    mocks.inspectProjectPath.mockImplementation(async ({ path }: { path: string }) => ({
      isDirectory: true,
      isGitRepo: true,
      existingProject: path === '/parent' ? parentProject : undefined,
    }));
    const store = new ProjectManagerStore();

    const result = await store.startProjectCreation(
      { type: 'local' },
      {
        mode: 'new',
        name: 'child-project',
        path: '/parent',
        repositoryName: 'child-project',
        repositoryOwner: 'acme',
        repositoryVisibility: 'private',
      },
      { id: 'optimistic-project' }
    );

    if (result.kind === 'creating') void result.completion;
    expect(result.kind).toBe('creating');
    expect(store.projects.has('optimistic-project')).toBe(true);
  });

  it('persists the selected GitHub account after registering a new project', async () => {
    const store = new ProjectManagerStore();

    const result = await store.startProjectCreation(
      { type: 'local' },
      {
        mode: 'new',
        name: 'Project',
        path: '/parent',
        repositoryName: 'project',
        repositoryOwner: 'acme',
        repositoryVisibility: 'private',
        githubAccountId: 'github.com:42',
      },
      { id: 'optimistic-project' }
    );

    if (result.kind === 'creating') await result.completion;

    expect(mocks.patchProjectSettings).toHaveBeenCalledWith({
      projectId: 'optimistic-project',
      patch: { githubAccountId: 'github.com:42' },
    });
    expect(mocks.updateProjectSettings).not.toHaveBeenCalled();
  });

  it('removes window listeners on dispose', () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal('window', { addEventListener, removeEventListener });
    const store = new ProjectManagerStore();

    store.dispose();
    store.dispose();

    expect(removeEventListener).toHaveBeenCalledWith('online', expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith('focus', expect.any(Function));
    expect(addEventListener).toHaveBeenCalledWith('online', expect.any(Function));
    expect(addEventListener).toHaveBeenCalledWith('focus', expect.any(Function));
  });

  it('retries SSH-disconnected projects without mounting before the connection is ready', async () => {
    const store = new ProjectManagerStore();
    const project = sshProject();
    store.projects.set(
      project.id,
      createUnmountedProject(project, {
        kind: 'failed',
        message: project.connectionId,
        code: 'ssh-disconnected',
      })
    );

    store.retryDisconnectedSshProjects({ force: true });
    await Promise.resolve();

    expect(mocks.sshEnsureConnected).toHaveBeenCalledWith('ssh-1', { force: true });
    expect(mocks.openProject).not.toHaveBeenCalled();
  });

  it('mounts SSH-disconnected projects after a connection-ready notification', async () => {
    const store = new ProjectManagerStore();
    const project = sshProject();
    store.projects.set(
      project.id,
      createUnmountedProject(project, {
        kind: 'failed',
        message: project.connectionId,
        code: 'ssh-disconnected',
      })
    );

    store.onSshConnectionReady('ssh-1');

    await vi.waitFor(() =>
      expect(mocks.openProject).toHaveBeenCalledWith({ projectId: project.id })
    );
  });

  it('mounts SSH-disconnected projects when the connection is already connected', async () => {
    mocks.sshStateFor.mockReturnValue('connected');
    const store = new ProjectManagerStore();
    const project = sshProject();
    store.projects.set(
      project.id,
      createUnmountedProject(project, {
        kind: 'failed',
        message: project.connectionId,
        code: 'ssh-disconnected',
      })
    );

    store.retryDisconnectedSshProjects({ force: true });

    expect(mocks.sshEnsureConnected).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(mocks.openProject).toHaveBeenCalledWith({ projectId: project.id })
    );
  });

  it('stores SSH-disconnected mount failures as an atomic unmounted payload', async () => {
    mocks.openProject.mockResolvedValueOnce({
      success: false,
      error: { type: 'ssh-disconnected', connectionId: 'ssh-1' },
    });
    const store = new ProjectManagerStore();
    const project = sshProject();
    store.projects.set(project.id, createUnmountedProject(project, { kind: 'idle' }));

    await store.mountProject(project.id);

    const projectStore = store.projects.get(project.id);
    expect(projectStore && isUnmountedProject(projectStore)).toBe(true);
    expect(projectStore?.unmounted).toEqual({
      kind: 'failed',
      message: 'ssh-1',
      code: 'ssh-disconnected',
    });
  });

  it('does not write GitHub account settings when creation did not specify one', async () => {
    mocks.createProject.mockResolvedValueOnce(
      okProject(localProject({ id: 'optimistic-project' }))
    );
    const store = new ProjectManagerStore();

    const result = await store.startProjectCreation(
      { type: 'local' },
      { mode: 'pick', name: 'Project', path: '/project' },
      { id: 'optimistic-project' }
    );

    if (result.kind === 'creating') await result.completion;

    expect(mocks.patchProjectSettings).not.toHaveBeenCalled();
    expect(mocks.updateProjectSettings).not.toHaveBeenCalled();
  });

  it('marks project creation as failed when the project RPC returns a typed error', async () => {
    mocks.createProject.mockResolvedValueOnce({
      success: false,
      error: {
        type: 'not-repository',
        path: '/project',
      },
    });
    const store = new ProjectManagerStore();

    const result = await store.startProjectCreation(
      { type: 'local' },
      { mode: 'pick', name: 'Project', path: '/project' },
      { id: 'optimistic-project' }
    );

    expect(result.kind).toBe('creating');
    if (result.kind === 'creating') {
      await expect(result.completion).resolves.toEqual({
        success: false,
        error: { type: 'not-repository', path: '/project' },
      });
    }

    const project = store.projects.get('optimistic-project');
    expect(project && isUnregisteredProject(project)).toBe(true);
    if (project && isUnregisteredProject(project)) {
      expect(project.creation).toEqual({
        kind: 'failed',
        stage: 'registering',
        message:
          'Directory is not a git repository. Enable "Initialize git repository" to continue.',
      });
    }
  });

  it('marks project creation with an inspection failure message', async () => {
    mocks.createProject.mockResolvedValueOnce({
      success: false,
      error: {
        type: 'inspect-failed',
        path: '/Volumes/Data/dev/myapp',
        message: 'Permission denied',
      },
    });
    const store = new ProjectManagerStore();

    const result = await store.startProjectCreation(
      { type: 'local' },
      { mode: 'pick', name: 'Project', path: '/Volumes/Data/dev/myapp' },
      { id: 'optimistic-project' }
    );

    expect(result.kind).toBe('creating');
    if (result.kind === 'creating') {
      await expect(result.completion).resolves.toEqual({
        success: false,
        error: {
          type: 'inspect-failed',
          path: '/Volumes/Data/dev/myapp',
          message: 'Permission denied',
        },
      });
    }

    const project = store.projects.get('optimistic-project');
    expect(project && isUnregisteredProject(project)).toBe(true);
    if (project && isUnregisteredProject(project)) {
      expect(project.creation).toEqual({
        kind: 'failed',
        stage: 'registering',
        message: 'Could not inspect directory: Permission denied',
      });
    }
  });

  it('persists the default GitHub account after initializing a picked folder', async () => {
    mocks.createProject.mockResolvedValueOnce(
      okProject(localProject({ id: 'optimistic-project' }))
    );
    const store = new ProjectManagerStore();

    const result = await store.startProjectCreation(
      { type: 'local' },
      {
        mode: 'pick',
        name: 'Project',
        path: '/project',
        initGitRepository: true,
        githubAccountId: 'github.com:42',
      },
      { id: 'optimistic-project' }
    );

    if (result.kind === 'creating') await result.completion;

    expect(mocks.patchProjectSettings).toHaveBeenCalledWith({
      projectId: 'optimistic-project',
      patch: { githubAccountId: 'github.com:42' },
    });
    expect(mocks.updateProjectSettings).not.toHaveBeenCalled();
  });

  it('does not persist a GitHub account for picked repositories that were already git repos', async () => {
    mocks.createProject.mockResolvedValueOnce(
      okProject(localProject({ id: 'optimistic-project' }))
    );
    const store = new ProjectManagerStore();

    const result = await store.startProjectCreation(
      { type: 'local' },
      {
        mode: 'pick',
        name: 'Project',
        path: '/project',
        githubAccountId: 'github.com:42',
      },
      { id: 'optimistic-project' }
    );

    if (result.kind === 'creating') await result.completion;

    expect(mocks.patchProjectSettings).not.toHaveBeenCalled();
    expect(mocks.updateProjectSettings).not.toHaveBeenCalled();
  });

  it('uses the selected GitHub account when creating a repository for a new project', async () => {
    const store = new ProjectManagerStore();

    const result = await store.startProjectCreation(
      { type: 'local' },
      {
        mode: 'new',
        name: 'Project',
        path: '/parent',
        repositoryName: 'project',
        repositoryOwner: 'acme',
        repositoryVisibility: 'private',
        githubAccountId: 'github.com:42',
      },
      { id: 'optimistic-project' }
    );

    if (result.kind === 'creating') void result.completion;

    await vi.waitFor(() =>
      expect(mocks.createGithubRepository).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 'github.com:42' })
      )
    );
  });

  it('clones a newly created repository from the API-provided clone URL', async () => {
    mocks.createGithubRepository.mockResolvedValueOnce({
      success: true,
      repoUrl: 'https://ghe.example.com/acme/project',
      cloneUrl: 'https://ghe.example.com/acme/project.git',
      nameWithOwner: 'acme/project',
    });
    const store = new ProjectManagerStore();

    const result = await store.startProjectCreation(
      { type: 'local' },
      {
        mode: 'new',
        name: 'Project',
        path: '/parent',
        repositoryName: 'project',
        repositoryOwner: 'acme',
        repositoryVisibility: 'private',
        githubAccountId: 'ghe.example.com:168',
      },
      { id: 'optimistic-project' }
    );

    if (result.kind === 'creating') await result.completion;

    expect(mocks.projectWireCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryUrl: 'https://ghe.example.com/acme/project.git',
        targetPath: '/parent/Project',
      })
    );
  });

  it('deletes a newly created GitHub repository with the selected account if clone fails', async () => {
    let rejectResult: (error: unknown) => void = () => {};
    mocks.projectWireResult = new Promise<LocalProject>((_, reject) => {
      rejectResult = reject;
    });
    const store = new ProjectManagerStore();

    const result = await store.startProjectCreation(
      { type: 'local' },
      {
        mode: 'new',
        name: 'Project',
        path: '/parent',
        repositoryName: 'project',
        repositoryOwner: 'acme',
        repositoryVisibility: 'private',
        githubAccountId: 'github.com:42',
      },
      { id: 'optimistic-project' }
    );

    expect(result.kind).toBe('creating');
    await vi.waitFor(() => expect(mocks.projectWireProgressCallbacks).toHaveLength(1));
    mocks.projectWireProgressCallbacks[0]?.({ phase: 'cloning' });
    rejectResult(new LiveJobFailedError({ type: 'clone-failed', message: 'Clone failed' }));
    if (result.kind === 'creating') {
      await expect(result.completion).resolves.toEqual({
        success: false,
        error: { type: 'clone-failed', message: 'Clone failed' },
      });
    }
    expect(store.projects.get('optimistic-project')?.creation).toEqual({
      kind: 'failed',
      stage: 'cloning',
      message: 'Clone failed',
    });

    expect(mocks.deleteGithubRepository).toHaveBeenCalledWith({
      owner: 'acme',
      name: 'project',
      accountId: 'github.com:42',
    });
    expect(mocks.createProject).not.toHaveBeenCalled();
  });

  it('starts new-project cloning on the SSH host and rolls back GitHub if it fails', async () => {
    mocks.projectWireResult = Promise.reject(
      new LiveJobFailedError({ type: 'clone-failed', message: 'Remote clone failed' })
    );
    const store = new ProjectManagerStore();

    const result = await store.startProjectCreation(
      { type: 'ssh', connectionId: 'ssh-1' },
      {
        mode: 'new',
        name: 'Project',
        path: '/remote/parent',
        repositoryName: 'project',
        repositoryOwner: 'acme',
        repositoryVisibility: 'private',
        githubAccountId: 'github.com:42',
      },
      { id: 'optimistic-project' }
    );

    expect(result.kind).toBe('creating');
    if (result.kind === 'creating') {
      await expect(result.completion).resolves.toEqual({
        success: false,
        error: { type: 'clone-failed', message: 'Remote clone failed' },
      });
    }

    expect(mocks.inspectProjectPath).toHaveBeenCalledWith({
      type: 'ssh',
      connectionId: 'ssh-1',
      path: '/remote/parent/Project',
    });
    expect(mocks.projectWireCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        host: { type: 'ssh', connectionId: 'ssh-1' },
        mode: 'new',
        repositoryUrl: 'https://github.com/acme/project.git',
        targetPath: '/remote/parent/Project',
      })
    );
    expect(mocks.deleteGithubRepository).toHaveBeenCalledWith({
      owner: 'acme',
      name: 'project',
      accountId: 'github.com:42',
    });
  });

  it('does not attempt GitHub repository rollback when repository creation fails', async () => {
    mocks.createGithubRepository.mockResolvedValueOnce({
      success: false,
      error: 'Repository creation failed',
    });
    const store = new ProjectManagerStore();

    const result = await store.startProjectCreation(
      { type: 'local' },
      {
        mode: 'new',
        name: 'Project',
        path: '/parent',
        repositoryName: 'project',
        repositoryOwner: 'acme',
        repositoryVisibility: 'private',
        githubAccountId: 'github.com:42',
      },
      { id: 'optimistic-project' }
    );

    expect(result.kind).toBe('creating');
    if (result.kind === 'creating') {
      await expect(result.completion).resolves.toEqual({
        success: false,
        error: { type: 'repository-create-failed', message: 'Repository creation failed' },
      });
    }

    expect(mocks.deleteGithubRepository).not.toHaveBeenCalled();
  });
});
