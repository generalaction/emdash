import { hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { hostFileRef } from '@emdash/core/primitives/path/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Automation } from '@core/primitives/automations/api';
import { hostPathFromNative } from '@core/primitives/desktop-runtime/api';
import { DEFAULT_PRESERVE_PATTERNS } from '@core/primitives/project-settings/api';
import { buildAutomationDeployment } from './deployment-builder';

const mocks = vi.hoisted(() => ({
  getProjectById: vi.fn(),
  resolveWorkspace: vi.fn(),
  select: vi.fn(),
  rows: [] as unknown[][],
  resolveWorktreePool: vi.fn(),
}));

const dependencies = {
  db: { select: mocks.select } as never,
  getProjectById: mocks.getProjectById,
  resolveWorkspace: mocks.resolveWorkspace,
  resolveWorktreePool: mocks.resolveWorktreePool,
};

const repositoryRef = hostFileRef(LOCAL_HOST_REF, hostPathFromNative('/repo'));

function automationFixture(): Automation {
  return {
    id: 'automation-1',
    projectId: 'project-1',
    name: 'Review changes',
    enabled: true,
    revision: 1,
    createdAt: 10,
    updatedAt: 20,
    triggerConfig: { expr: '0 9 * * 1', tz: 'America/Los_Angeles' },
    conversationConfig: {
      prompt: 'Review the latest changes',
      provider: 'claude',
      model: 'sonnet',
      autoApprove: false,
      type: 'acp',
    },
    taskConfig: {
      version: '1',
      taskConfig: { version: '1', name: 'Review changes' },
      workspaceConfig: {
        version: '2',
        git: {
          kind: 'create-branch',
          branchName: 'replaced-per-run',
          fromBranch: { type: 'local', branch: 'main' },
          pushBranch: true,
        },
        workspace: { kind: 'new-worktree' },
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows = [];
  mocks.select.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: async () => mocks.rows.shift() ?? [],
      }),
    }),
  }));
  mocks.getProjectById.mockResolvedValue({
    id: 'project-1',
    type: 'local',
    path: '/repo',
    repositoryWorkspaceId: 'repository-workspace',
  });
  mocks.resolveWorktreePool.mockResolvedValue({
    success: true,
    data: '/worktrees/repo-12345678',
  });
  mocks.resolveWorkspace.mockResolvedValue(null);
});

describe('buildAutomationDeployment', () => {
  it('captures worktree, project, schedule, and ACP session settings', async () => {
    mocks.rows.push([
      {
        base: JSON.stringify({ baseRemote: 'origin', pushRemote: 'fork' }),
        shareable: JSON.stringify({ preservePatterns: ['.env.local'] }),
      },
    ]);

    await expect(buildAutomationDeployment(dependencies, automationFixture())).resolves.toEqual({
      success: true,
      data: {
        automationId: 'automation-1',
        enabled: true,
        name: 'Review changes',
        revision: 1,
        schedule: { expr: '0 9 * * 1', tz: 'America/Los_Angeles' },
        agent: {
          type: 'acp',
          title: 'Review changes',
          start: {
            providerId: 'claude',
            model: 'sonnet',
            initialQueue: [{ text: 'Review the latest changes' }],
          },
        },
        workspace: {
          kind: 'worktree',
          repository: repositoryRef,
          worktreePoolPath: hostPathFromNative('/worktrees/repo-12345678'),
          baseRemote: 'origin',
          preservePatterns: ['.env.local'],
          git: {
            kind: 'create-branch',
            fromBranch: { type: 'local', branch: 'main' },
            pushRemote: 'fork',
          },
        },
      },
    });
  });

  it('builds remote deployments with the project runtime host', async () => {
    const remote = hostRef('remote', 'ssh-1');
    mocks.getProjectById.mockResolvedValue({
      id: 'project-1',
      type: 'ssh',
      path: '/repo',
      connectionId: 'ssh-1',
    });

    await expect(buildAutomationDeployment(dependencies, automationFixture())).resolves.toEqual({
      success: true,
      data: {
        automationId: 'automation-1',
        enabled: true,
        name: 'Review changes',
        revision: 1,
        schedule: { expr: '0 9 * * 1', tz: 'America/Los_Angeles' },
        agent: {
          type: 'acp',
          title: 'Review changes',
          start: {
            providerId: 'claude',
            model: 'sonnet',
            initialQueue: [{ text: 'Review the latest changes' }],
          },
        },
        workspace: {
          kind: 'worktree',
          repository: hostFileRef(remote, hostPathFromNative('/repo')),
          worktreePoolPath: hostPathFromNative('/worktrees/repo-12345678'),
          baseRemote: 'origin',
          preservePatterns: [...DEFAULT_PRESERVE_PATTERNS],
          git: {
            kind: 'create-branch',
            fromBranch: { type: 'local', branch: 'main' },
            pushRemote: 'origin',
          },
        },
      },
    });
  });

  it('uses the resolved workspace host for repository-instance deployments', async () => {
    const remote = hostRef('remote', 'ssh-1');
    const automation = automationFixture();
    automation.taskConfig!.workspaceConfig.workspace = {
      kind: 'repository-instance',
      workspaceId: 'workspace-1',
    };
    mocks.getProjectById.mockResolvedValue({
      id: 'project-1',
      type: 'ssh',
      path: '/repo',
      connectionId: 'ssh-1',
    });
    mocks.resolveWorkspace.mockResolvedValue({
      workspaceId: 'workspace-1',
      host: remote,
      path: '/repo/worktree',
      projectId: 'project-1',
    });

    const result = await buildAutomationDeployment(dependencies, automation);

    expect(result).toMatchObject({
      success: true,
      data: {
        workspace: {
          kind: 'directory',
          path: hostFileRef(remote, hostPathFromNative('/repo/worktree')),
        },
      },
    });
    expect(mocks.resolveWorktreePool).not.toHaveBeenCalled();
  });
});
