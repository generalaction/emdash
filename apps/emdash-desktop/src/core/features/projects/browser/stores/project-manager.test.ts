import { LiveJobCancelledError, LiveJobFailedError } from '@emdash/wire';
import type * as Wire from '@emdash/wire';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceBootstrapProgress } from '@core/features/workspaces/api';
import type { LocalProject, SshProject } from '@core/primitives/projects/api';
import { createUnmountedProject, isUnregisteredProject, type ProjectStore } from './project';
import { ProjectManagerStore } from './project-manager';

const mocks = vi.hoisted(() => ({
  createGithubRepository: vi.fn(),
  createLiveJobReplica: vi.fn(),
  createProject: vi.fn(),
  deleteGithubRepository: vi.fn(),
  inspectProjectPath: vi.fn(),
  openProject: vi.fn(),
  patchProjectSettings: vi.fn(),
  projectWireCreate: vi.fn(),
  projectWireCancel: vi.fn(),
  projectWireDelete: vi.fn(),
  projectWireProgressCallbacks: [] as Array<(progress: WorkspaceBootstrapProgress) => void>,
  projectWireResult: undefined as Promise<LocalProject> | undefined,
  resolveRepositoryDestination: vi.fn(),
  deleteMementoSubject: vi.fn(),
  mementoReportError: vi.fn(),
  updateProjectSettings: vi.fn(),
  sshConnect: vi.fn(),
  sshStateFor: vi.fn(),
}));

vi.mock('@renderer/lib/runtime/desktop-wire-client', () => ({
  getDesktopWireClient: async () => ({
    github: {
      createRepository: mocks.createGithubRepository,
      deleteRepository: mocks.deleteGithubRepository,
    },
    projects: {
      createProject: mocks.createProject,
      getProjects: vi.fn(async () => []),
      inspectProjectPath: mocks.inspectProjectPath,
      resolveRepositoryDestination: mocks.resolveRepositoryDestination,
      openProject: mocks.openProject,
      patchProjectSettings: mocks.patchProjectSettings,
      updateProjectSettings: mocks.updateProjectSettings,
    },
  }),
}));

vi.mock('@emdash/wire', async (importOriginal) => {
  const actual = await importOriginal<typeof Wire>();
  return {
    ...actual,
    createLiveJobReplica: mocks.createLiveJobReplica,
  };
});

vi.mock('@renderer/lib/runtime/projects-wire-client', () => ({
  getProjectsWireClient: async () => ({ create: {}, delete: mocks.projectWireDelete }),
}));

vi.mock('@renderer/lib/mementos', () => ({
  getMementoClient: () => ({
    deleteBySubject: mocks.deleteMementoSubject,
    reportError: mocks.mementoReportError,
  }),
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    navigation: {
      currentViewId: 'home',
      currentRef: { viewId: 'home', params: {}, key: 'home' },
      navigate: vi.fn(),
      invalidateSubject: vi.fn(),
    },
    history: { prune: vi.fn() },
    machines: {
      connect: mocks.sshConnect,
      stateFor: mocks.sshStateFor,
    },
  },
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

vi.mock('@renderer/utils/telemetryClient', () => ({
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
    mocks.createLiveJobReplica.mockReturnValue({
      start: async (input: {
        projectId: string;
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
                localProject({
                  id: input.projectId,
                  name: input.name,
                  path: input.targetPath,
                })
              ),
            onProgress: (cb: (progress: WorkspaceBootstrapProgress) => void) => {
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
    expect(pendingProject?.phase).toBe('registering');
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

  it('returns a typed host-unavailable error for remote clones', async () => {
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
      await expect(result.completion).resolves.toEqual({
        success: false,
        error: {
          type: 'host-unavailable',
          host: { type: 'remote', id: 'ssh-1' },
          message:
            'Remote projects require the workspace server and are not supported by this build',
        },
      });
    }
    expect(mocks.projectWireCreate).not.toHaveBeenCalled();
  });

  it('stores remote creation operation progress on the pending project', async () => {
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

    const progress: WorkspaceBootstrapProgress = {
      step: 'setting-up-workspace',
      message: 'Cloning repository',
      operation: {
        operationId: 'operation-1',
        kind: 'provision',
        stages: [
          {
            id: 'git-clone',
            label: 'Cloning repository',
            status: 'running',
            progress: { percent: 42, message: 'Receiving objects' },
          },
        ],
      },
    };
    mocks.projectWireProgressCallbacks[0]?.(progress);

    const pendingProject = store.projects.get('optimistic-project');
    expect(pendingProject && isUnregisteredProject(pendingProject)).toBe(true);
    if (pendingProject && isUnregisteredProject(pendingProject)) {
      expect(pendingProject.progressMessage).toBe('Cloning repository');
      expect(pendingProject.operation).toStrictEqual(progress.operation);
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
    store.projects.set(project.id, createUnmountedProject(project, 'idle'));
    const projectStore = store.projects.get(project.id);
    if (!projectStore) throw new Error('Expected project store');
    projectStore.phase = 'error';
    projectStore.error = project.connectionId;
    projectStore.errorCode = 'ssh-disconnected';

    store.retryDisconnectedSshProjects({ force: true });
    await Promise.resolve();

    expect(mocks.sshConnect).toHaveBeenCalledWith('ssh-1', { force: true });
    expect(mocks.openProject).not.toHaveBeenCalled();
  });

  it('mounts SSH-disconnected projects after a connection-ready notification', async () => {
    const store = new ProjectManagerStore();
    const project = sshProject();
    store.projects.set(project.id, createUnmountedProject(project, 'idle'));
    const projectStore = store.projects.get(project.id);
    if (!projectStore) throw new Error('Expected project store');
    projectStore.phase = 'error';
    projectStore.error = project.connectionId;
    projectStore.errorCode = 'ssh-disconnected';

    store.onSshConnectionReady('ssh-1');

    await vi.waitFor(() =>
      expect(mocks.openProject).toHaveBeenCalledWith({ projectId: project.id })
    );
  });

  it('mounts SSH-disconnected projects when the connection is already connected', async () => {
    mocks.sshStateFor.mockReturnValue('connected');
    const store = new ProjectManagerStore();
    const project = sshProject();
    store.projects.set(project.id, createUnmountedProject(project, 'idle'));
    const projectStore = store.projects.get(project.id);
    if (!projectStore) throw new Error('Expected project store');
    projectStore.phase = 'error';
    projectStore.error = project.connectionId;
    projectStore.errorCode = 'ssh-disconnected';

    store.retryDisconnectedSshProjects({ force: true });

    expect(mocks.sshConnect).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(mocks.openProject).toHaveBeenCalledWith({ projectId: project.id })
    );
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
      expect(project.phase).toBe('error');
      expect(project.error).toBe(
        'Directory is not a git repository. Enable "Initialize git repository" to continue.'
      );
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
      expect(project.phase).toBe('error');
      expect(project.error).toBe('Could not inspect directory: Permission denied');
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
    mocks.projectWireResult = Promise.reject(
      new LiveJobFailedError({ type: 'clone-failed', message: 'Clone failed' })
    );
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
        error: { type: 'clone-failed', message: 'Clone failed' },
      });
    }

    expect(mocks.deleteGithubRepository).toHaveBeenCalledWith({
      owner: 'acme',
      name: 'project',
      accountId: 'github.com:42',
    });
    expect(mocks.createProject).not.toHaveBeenCalled();
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
