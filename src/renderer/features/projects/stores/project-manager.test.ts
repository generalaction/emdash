import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalProject } from '@shared/projects';
import { isUnregisteredProject } from './project';
import { ProjectManagerStore } from './project-manager';

const mocks = vi.hoisted(() => ({
  cloneRepository: vi.fn(),
  createGithubRepository: vi.fn(),
  createProject: vi.fn(),
  initializeProject: vi.fn(),
  inspectProjectPath: vi.fn(),
  openProject: vi.fn(),
  eventOn: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: mocks.eventOn,
  },
  rpc: {
    github: {
      cloneRepository: mocks.cloneRepository,
      createRepository: mocks.createGithubRepository,
      initializeProject: mocks.initializeProject,
    },
    projects: {
      createProject: mocks.createProject,
      getProjects: vi.fn(async () => []),
      inspectProjectPath: mocks.inspectProjectPath,
      openProject: mocks.openProject,
    },
  },
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    navigation: {
      currentViewId: 'home',
      revalidate: vi.fn(),
      viewParamsStore: {},
    },
  },
}));

vi.mock('@renderer/lib/stores/view-state-cache', () => ({
  viewStateCache: {
    get: vi.fn(async () => undefined),
  },
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

describe('ProjectManagerStore project creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inspectProjectPath.mockResolvedValue({ isDirectory: true, isGitRepo: true });
    mocks.createProject.mockResolvedValue(localProject());
    mocks.openProject.mockReturnValue(new Promise(() => {}));
    mocks.cloneRepository.mockReturnValue(new Promise(() => {}));
    mocks.createGithubRepository.mockResolvedValue({
      success: true,
      repoUrl: 'https://github.com/acme/project.git',
      nameWithOwner: 'acme/project',
    });
    mocks.initializeProject.mockResolvedValue({ success: true });
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
      new Promise<LocalProject>((resolve) => {
        resolveCreateProject = resolve;
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

    if (result.kind === 'creating') void result.completion.catch(() => {});
    expect(mocks.inspectProjectPath).toHaveBeenCalledWith({
      type: 'local',
      path: '/parent/child-project',
    });
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

    if (result.kind === 'creating') void result.completion.catch(() => {});
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

    if (result.kind === 'creating') void result.completion.catch(() => {});
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

    if (result.kind === 'creating') void result.completion.catch(() => {});
    expect(result.kind).toBe('creating');
    expect(store.projects.has('optimistic-project')).toBe(true);
  });
});
