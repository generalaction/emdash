import { err, ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectSettingsService } from './project-settings-service';

const sharingMocks = vi.hoisted(() => ({
  resolveTarget: vi.fn(async () => ({
    type: 'project' as const,
    label: 'Project repository',
    path: '/repo',
    configPath: '/repo/.emdash.json',
    sourceWorkspaceId: 'repo-1',
    files: {},
  })),
  write: vi.fn(async () => ({ success: true as const, data: ['scripts.setup'] as const })),
}));

vi.mock('../../../node/settings/sharing/project-settings-target-resolver', () => ({
  resolveAllProjectSettingsTargets: vi.fn(async () => [
    {
      type: 'project',
      label: 'Project repository',
      path: '/repo',
      configPath: '/repo/.emdash.json',
      files: {},
    },
  ]),
  getProjectSettingsWriteTargets: vi.fn((targets) =>
    targets.map(({ files: _files, ...target }: { files: unknown }) => target)
  ),
  resolveProjectSettingsTarget: sharingMocks.resolveTarget,
}));

vi.mock('../../../node/settings/sharing/share-project-settings-to-config', () => ({
  shareProjectSettingsToConfig: sharingMocks.write,
}));

function configState() {
  return {
    workspaceId: 'repo-1',
    repositoryId: 'repo-1',
    resolved: {
      preservePatterns: { value: [], from: 'built-in' as const },
      setup: { value: 'old setup', from: 'personal' as const },
      autoRunSetup: { value: true, from: 'built-in' as const },
      autoRunRun: { value: true, from: 'personal' as const },
    },
    personalConfig: { scripts: { setup: 'old setup' }, autoRunRun: true },
    sources: {
      preservePatterns: [],
      prepare: [],
      setup: [
        {
          workspaceId: 'repo-1',
          path: '/repo/.emdash.json',
          value: 'team setup',
        },
      ],
      run: [],
      teardown: [],
      shellSetup: [],
    },
    legacyDesktopSettingsMigrated: true,
  };
}

function fixture() {
  const update = vi.fn(async () => ok(undefined));
  const patch = vi.fn(async () => ok(undefined));
  const patchPersonalProjectConfig = vi.fn(async () => ok(configState()));
  const refreshProjectConfig = vi.fn(async () => ok(configState()));
  const getProjectConfig = vi.fn(async () => ok(configState()));
  const createWorkspace = vi.fn(async () => ok({} as never));
  const configSource = {};
  const projectConfigState = vi.fn(() => ({
    asLiveSource: () => configSource,
  }));
  const project = {
    projectId: 'project-1',
    repoPath: '/repo',
    project: { repositoryWorkspaceId: 'repo-1' },
    settings: {
      update,
      patch,
      get: vi.fn(async () => ({})),
      getStoredGitSettings: vi.fn(async () => ({
        baseRemote: 'origin',
        pushRemote: 'stale-fork',
        agentGitCredentials: 'none' as const,
        worktreeRoot: '/project/worktrees',
      })),
      getStoredPlacementSettings: vi.fn(async () => ({ tmux: true })),
      getWorktreeRootContext: vi.fn(async () => ({
        hostWorktreeRoot: null,
        builtInWorktreeRoot: '/tmp/worktrees',
        homeDirectory: '/tmp',
      })),
    },
    workspaceRegistry: {
      getProjectConfig,
      createWorkspace,
      patchPersonalProjectConfig,
      refreshProjectConfig,
      projectConfig: { state: projectConfigState },
    },
  };
  const service = new ProjectSettingsService({
    db: {} as never,
    projects: { getProject: () => project as never },
    workspaceIdentity: {} as never,
  });
  return {
    service,
    update,
    patch,
    patchPersonalProjectConfig,
    refreshProjectConfig,
    getProjectConfig,
    createWorkspace,
    projectConfigState,
    configSource,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sharingMocks.write.mockResolvedValue({ success: true, data: ['scripts.setup'] });
});

describe('ProjectSettingsService personal lifecycle writes', () => {
  it('forwards the project config live source by repository workspace id', async () => {
    const { service, projectConfigState, configSource } = fixture();

    await expect(service.getProjectConfigLiveSource('project-1')).resolves.toBe(configSource);
    expect(projectConfigState).toHaveBeenCalledWith({ workspaceId: 'repo-1' }, 'current');
  });

  it('returns self-contained raw, resolved, source, and write-target snapshots', async () => {
    const { service } = fixture();

    const result = await service.getProjectSettingsPage('project-1');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.domains.lifecycle).toMatchObject({
      personal: { scripts: { setup: 'old setup' }, autoRunRun: true },
      team: { scripts: { setup: 'team setup' } },
      resolved: {
        setup: { value: 'old setup', from: 'personal' },
      },
      sources: {
        setup: [
          {
            label: 'Project repository',
            path: '/repo',
            configPath: '/repo/.emdash.json',
            value: 'team setup',
          },
        ],
      },
      writeTargets: [
        {
          type: 'project',
          label: 'Project repository',
          path: '/repo',
          configPath: '/repo/.emdash.json',
        },
      ],
    });
    expect(result.data.domains.gitIdentity).toEqual({
      stored: {
        baseRemote: 'origin',
        pushRemote: 'stale-fork',
        agentGitCredentials: 'none',
      },
    });
    expect(result.data.domains.placement).toMatchObject({
      stored: { worktreeRoot: '/project/worktrees', tmux: true },
      layers: {
        hostWorktreeRoot: null,
        builtInWorktreeRoot: '/tmp/worktrees',
        homeDirectory: '/tmp',
      },
      resolved: {
        worktreeRoot: {
          value: '/project/worktrees',
          provenance: { kind: 'set' },
        },
      },
    });
  });

  it('registers a missing repository record and retries settings-page assembly', async () => {
    const { service, getProjectConfig, createWorkspace } = fixture();
    getProjectConfig
      .mockResolvedValueOnce(err({ type: 'workspace-not-found', workspaceId: 'repo-1' }) as never)
      .mockResolvedValueOnce(ok(configState()));

    const result = await service.getProjectSettingsPage('project-1');

    expect(result.success).toBe(true);
    expect(createWorkspace).toHaveBeenCalledWith({ workspaceId: 'repo-1', path: '/repo' });
    expect(getProjectConfig).toHaveBeenCalledTimes(2);
  });

  it('returns unresolved registry failures from page, share, and migration operations', async () => {
    const operations = [
      (service: ProjectSettingsService) => service.getProjectSettingsPage('project-1'),
      (service: ProjectSettingsService) =>
        service.shareProjectSettingsToConfig('project-1', {
          target: { type: 'project' },
          fields: ['scripts.setup'],
        }),
      (service: ProjectSettingsService) =>
        service.migrateProjectConfig('project-1', {
          providerId: 'codex',
        } as never),
    ];

    for (const operation of operations) {
      const { service, getProjectConfig, createWorkspace } = fixture();
      getProjectConfig.mockResolvedValue(
        err({ type: 'workspace-not-found', workspaceId: 'repo-1' }) as never
      );
      createWorkspace.mockResolvedValue(err({ type: 'path-not-found', path: '/repo' }) as never);

      await expect(operation(service)).resolves.toEqual({
        success: false,
        error: { type: 'error' },
      });
    }
  });

  it('applies ordinary saves as explicit registry and DB domain patches', async () => {
    const { service, update, patch, patchPersonalProjectConfig } = fixture();

    const result = await service.updateProjectSettings('project-1', {
      lifecycle: {
        personal: {
          scripts: { setup: 'new setup', run: null },
          autoRunRun: null,
        },
      },
      fileHandling: {
        personal: { preservePatterns: ['personal/**'] },
      },
      gitIdentity: {
        stored: { baseRemote: 'origin', agentGitCredentials: 'none' },
      },
      placement: {
        stored: { worktreeRoot: '/tmp/worktrees', tmux: true },
      },
    });

    expect(result.success).toBe(true);
    expect(patchPersonalProjectConfig).toHaveBeenCalledWith({
      workspaceId: 'repo-1',
      patch: {
        scripts: { setup: 'new setup', run: null },
        autoRunRun: null,
        preservePatterns: ['personal/**'],
      },
    });
    expect(patch).toHaveBeenCalledWith({
      gitIdentity: {
        stored: { baseRemote: 'origin', agentGitCredentials: 'none' },
      },
      placement: {
        stored: { worktreeRoot: '/tmp/worktrees', tmux: true },
      },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('reset removes only the requested personal fields', async () => {
    const { service, update, patchPersonalProjectConfig } = fixture();

    const result = await service.updateProjectSettings('project-1', {
      lifecycle: {
        personal: { scripts: { setup: null }, autoRunRun: null },
      },
      fileHandling: {
        personal: { preservePatterns: null },
      },
    });

    expect(result.success).toBe(true);
    expect(patchPersonalProjectConfig).toHaveBeenCalledWith({
      workspaceId: 'repo-1',
      patch: {
        scripts: { setup: null },
        autoRunRun: null,
        preservePatterns: null,
      },
    });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('ProjectSettingsService sharing orchestration', () => {
  it('writes, refreshes, then clears exactly the fields that were written', async () => {
    const { service, refreshProjectConfig, patchPersonalProjectConfig } = fixture();

    const result = await service.shareProjectSettingsToConfig('project-1', {
      target: { type: 'project' },
      fields: ['scripts.setup', 'scripts.run'],
    });

    expect(result.success).toBe(true);
    expect(sharingMocks.write).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: '/repo/.emdash.json' }),
      ['scripts.setup', 'scripts.run'],
      configState().personalConfig
    );
    expect(refreshProjectConfig).toHaveBeenCalledWith({ workspaceId: 'repo-1' });
    expect(patchPersonalProjectConfig).toHaveBeenCalledWith({
      workspaceId: 'repo-1',
      patch: { scripts: { setup: null } },
    });
    expect(sharingMocks.write.mock.invocationCallOrder[0]).toBeLessThan(
      refreshProjectConfig.mock.invocationCallOrder[0] ?? 0
    );
    expect(refreshProjectConfig.mock.invocationCallOrder[0]).toBeLessThan(
      patchPersonalProjectConfig.mock.invocationCallOrder[0] ?? 0
    );
  });

  it('does not clear personal fields if the consistency refresh fails', async () => {
    const { service, refreshProjectConfig, patchPersonalProjectConfig } = fixture();
    refreshProjectConfig.mockResolvedValueOnce({
      success: false,
      error: { type: 'error' },
    } as never);

    const result = await service.shareProjectSettingsToConfig('project-1', {
      target: { type: 'project' },
      fields: ['scripts.setup'],
    });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'write-config-failed',
        message:
          'Wrote .emdash.json, but failed to refresh shared project settings. Personal settings were not cleared.',
      },
    });
    expect(patchPersonalProjectConfig).not.toHaveBeenCalled();
  });
});
