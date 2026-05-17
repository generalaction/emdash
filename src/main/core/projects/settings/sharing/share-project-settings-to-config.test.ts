import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShareableProjectSettings } from '@shared/project-settings';
import { computeProjectSettingsOverrideState } from './project-settings-override-state';
import {
  getProjectSettingsWriteTargets,
  resolveAllProjectSettingsTargets,
} from './project-settings-target-resolver';
import { shareProjectSettingsToConfig } from './share-project-settings-to-config';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  workspaceGet: vi.fn(),
  listForProject: vi.fn(),
}));

vi.mock('@main/core/workspaces/workspace-registry', () => ({
  workspaceRegistry: {
    get: mocks.workspaceGet,
    listForProject: mocks.listForProject,
  },
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: mocks.select,
  },
}));

vi.mock('../utils', () => ({
  resolveWorkspace: vi.fn().mockReturnValue(null),
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    warn: vi.fn(),
  },
}));

describe('shareProjectSettingsToConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workspaceGet.mockReturnValue(undefined);
    mocks.listForProject.mockReturnValue([]);
  });

  it('writes selected shareable project settings to .emdash.json', async () => {
    const write = vi.fn().mockResolvedValue({ success: true, bytesWritten: 100 });
    const patch = vi.fn().mockResolvedValue({ success: true });
    const project = {
      fs: {
        exists: vi.fn().mockResolvedValue(false),
        write,
      },
      settings: {
        get: vi.fn().mockResolvedValue({
          defaultBranch: 'origin/main',
          baseRemote: 'origin',
          tmux: true,
          preservePatterns: ['.env', '.env.local'],
          shellSetup: 'nvm use',
          scripts: {
            setup: 'pnpm install',
            run: 'pnpm dev',
          },
        }),
        patch,
      },
    };

    const result = await shareProjectSettingsToConfig(
      project as never,
      {
        target: { type: 'project' },
        fields: ['preservePatterns', 'shellSetup', 'scripts.setup', 'scripts.run'],
      },
      [{ type: 'project', label: 'Repo Name', path: '/repo', fs: project.fs as never }]
    );

    expect(result.success).toBe(true);
    expect(write).toHaveBeenCalledWith(
      '.emdash.json',
      `${JSON.stringify(
        {
          preservePatterns: ['.env', '.env.local'],
          shellSetup: 'nvm use',
          scripts: {
            setup: 'pnpm install',
            run: 'pnpm dev',
          },
        },
        null,
        2
      )}\n`
    );
    expect(patch).toHaveBeenCalledWith({
      clearShareableFields: ['preservePatterns', 'shellSetup', 'scripts.setup', 'scripts.run'],
    });
  });

  it('preserves existing config fields when sharing a later script field to the same target', async () => {
    let configContent = '';
    let shareableSettings: ShareableProjectSettings = {
      preservePatterns: ['.env', '.env.local'],
    };
    const fs = {
      exists: vi.fn().mockImplementation(() => Promise.resolve(configContent !== '')),
      read: vi.fn().mockImplementation(() => Promise.resolve({ content: configContent })),
      write: vi.fn().mockImplementation((_path: string, content: string) => {
        configContent = content;
        return Promise.resolve({ success: true, bytesWritten: content.length });
      }),
    };
    const project = {
      fs,
      settings: {
        get: vi.fn().mockImplementation(() => Promise.resolve(shareableSettings)),
        patch: vi.fn().mockImplementation(({ clearShareableFields }) => {
          if (clearShareableFields.includes('preservePatterns')) {
            shareableSettings = {};
          }
          if (clearShareableFields.includes('scripts.run')) {
            shareableSettings = {};
          }
          return Promise.resolve({ success: true });
        }),
      },
    };
    const targets = [{ type: 'project' as const, label: 'Repo Name', path: '/repo', fs }];

    await shareProjectSettingsToConfig(
      project as never,
      {
        target: { type: 'project' },
        fields: ['preservePatterns'],
      },
      targets as never
    );

    shareableSettings = {
      scripts: {
        run: 'pnpm dev',
      },
    };

    const result = await shareProjectSettingsToConfig(
      project as never,
      {
        target: { type: 'project' },
        fields: ['scripts.run'],
      },
      targets as never
    );

    expect(result.success).toBe(true);
    expect(JSON.parse(configContent)).toEqual({
      preservePatterns: ['.env', '.env.local'],
      scripts: {
        run: 'pnpm dev',
      },
    });
  });

  it('only clears fields that were actually written to .emdash.json', async () => {
    const write = vi.fn().mockResolvedValue({ success: true, bytesWritten: 100 });
    const patch = vi.fn().mockResolvedValue({ success: true });
    const project = {
      fs: {
        exists: vi.fn().mockResolvedValue(true),
        read: vi.fn().mockResolvedValue({
          content: JSON.stringify({ preservePatterns: ['.env'] }),
        }),
        write,
      },
      settings: {
        get: vi.fn().mockResolvedValue({
          preservePatterns: ['.env.local'],
        }),
        patch,
      },
    };

    const result = await shareProjectSettingsToConfig(
      project as never,
      {
        target: { type: 'project' },
        fields: ['preservePatterns', 'scripts.run'],
      },
      [{ type: 'project', label: 'Repo Name', path: '/repo', fs: project.fs as never }]
    );

    expect(result.success).toBe(true);
    expect(write).toHaveBeenCalledWith(
      '.emdash.json',
      `${JSON.stringify({ preservePatterns: ['.env.local'] }, null, 2)}\n`
    );
    expect(patch).toHaveBeenCalledWith({
      clearShareableFields: ['preservePatterns'],
    });
  });

  it('returns an error when the filesystem reports an unsuccessful write', async () => {
    const patch = vi.fn();
    const project = {
      fs: {
        exists: vi.fn().mockResolvedValue(false),
        write: vi.fn().mockResolvedValue({
          success: false,
          bytesWritten: 0,
          error: 'permission denied',
        }),
      },
      settings: {
        get: vi.fn().mockResolvedValue({
          preservePatterns: ['.env'],
        }),
        patch,
      },
    };

    const result = await shareProjectSettingsToConfig(
      project as never,
      {
        target: { type: 'project' },
        fields: ['preservePatterns'],
      },
      [{ type: 'project', label: 'Repo Name', path: '/repo', fs: project.fs as never }]
    );

    expect(result).toEqual({
      success: false,
      error: { type: 'write-config-failed', message: 'permission denied' },
    });
    expect(patch).not.toHaveBeenCalled();
  });

  it('returns an error when clearing shared fields fails after writing config', async () => {
    const write = vi.fn().mockResolvedValue({ success: true, bytesWritten: 100 });
    const patch = vi.fn().mockResolvedValue({
      success: false,
      error: { type: 'error' },
    });
    const project = {
      fs: {
        exists: vi.fn().mockResolvedValue(true),
        read: vi.fn().mockResolvedValue({
          content: `${JSON.stringify({ shellSetup: 'old setup' }, null, 2)}\n`,
        }),
        write,
      },
      settings: {
        get: vi.fn().mockResolvedValue({
          preservePatterns: ['.env'],
        }),
        patch,
      },
    };

    const result = await shareProjectSettingsToConfig(
      project as never,
      {
        target: { type: 'project' },
        fields: ['preservePatterns'],
      },
      [{ type: 'project', label: 'Repo Name', path: '/repo', fs: project.fs as never }]
    );

    expect(result).toEqual({
      success: false,
      error: {
        type: 'write-config-failed',
        message: 'Wrote .emdash.json, but failed to clear shared project settings.',
      },
    });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('returns the read/parse failure when existing .emdash.json cannot be parsed', async () => {
    const project = {
      fs: {
        exists: vi.fn().mockResolvedValue(true),
        read: vi.fn().mockResolvedValue({ content: '{ invalid json' }),
      },
      settings: {
        get: vi.fn().mockResolvedValue({
          preservePatterns: ['.env'],
        }),
      },
    };

    const result = await shareProjectSettingsToConfig(
      project as never,
      {
        target: { type: 'project' },
        fields: ['preservePatterns'],
      },
      [{ type: 'project', label: 'Repo Name', path: '/repo', fs: project.fs as never }]
    );

    if (result.success) {
      throw new Error('Expected write to fail');
    }
    expect(result.error).toMatchObject({
      type: 'write-config-failed',
    });
    if (result.error.type !== 'write-config-failed') {
      throw new Error(`Unexpected error type: ${result.error.type}`);
    }
    expect(result.error.message).toContain('Could not read existing .emdash.json');
  });

  it('returns target resolution failures instead of rejecting the RPC', async () => {
    await expect(
      shareProjectSettingsToConfig(
        {
          settings: {
            get: vi.fn(),
          },
        } as never,
        {
          target: { type: 'task', taskId: 'task-1' },
          fields: ['preservePatterns'],
        },
        []
      )
    ).resolves.toEqual({
      success: false,
      error: {
        type: 'write-config-failed',
        message: 'Could not resolve the selected working copy.',
      },
    });
  });

  it('includes task worktrees from stored task state, not only active workspaces', async () => {
    const getWorktree = vi.fn().mockResolvedValue('/repo/.emdash/worktrees/task-one');
    const project = {
      projectId: 'project-1',
      repoPath: '/repo',
      fs: {},
      defaultWorkspaceType: { kind: 'local' },
      worktreeService: {
        getWorktree,
      },
    };
    mocks.select
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue([{ name: 'Repo Name' }]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: vi.fn().mockResolvedValue([
            {
              id: 'task-1',
              name: 'Task One',
              taskBranch: 'emdash/task-one',
              workspaceId: null,
            },
          ]),
        }),
      });
    const targets = getProjectSettingsWriteTargets(
      await resolveAllProjectSettingsTargets(project as never)
    );

    expect(targets).toEqual([
      { type: 'project', label: 'Repo Name', path: '/repo' },
      {
        type: 'task',
        taskId: 'task-1',
        label: 'Task One',
        path: '/repo/.emdash/worktrees/task-one',
      },
    ]);
    expect(getWorktree).toHaveBeenCalledWith('emdash/task-one');
  });

  it('excludes task targets that use the project root working directory', async () => {
    const projectRootFs = {
      exists: vi.fn().mockResolvedValue(true),
      read: vi.fn().mockResolvedValue({
        content: JSON.stringify({ shellSetup: 'root setup' }),
      }),
    };
    const worktreeFs = {
      exists: vi.fn().mockResolvedValue(true),
      read: vi.fn().mockResolvedValue({
        content: JSON.stringify({ shellSetup: 'worktree setup' }),
      }),
    };
    const getWorktree = vi.fn();
    const project = {
      projectId: 'project-1',
      repoPath: '/repo',
      fs: projectRootFs,
      defaultWorkspaceType: { kind: 'local' },
      worktreeService: {
        getWorktree,
      },
    };
    mocks.workspaceGet.mockImplementation((workspaceId: string) => {
      if (workspaceId === 'root-workspace') return { path: '/repo', fs: projectRootFs };
      if (workspaceId === 'worktree-workspace') {
        return { path: '/repo/.emdash/worktrees/task-two', fs: worktreeFs };
      }
      return undefined;
    });
    mocks.select
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue([{ name: 'Repo Name' }]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: vi.fn().mockResolvedValue([
            {
              id: 'task-1',
              name: 'Root Task',
              taskBranch: null,
              workspaceId: 'root-workspace',
            },
            {
              id: 'task-2',
              name: 'Task Two',
              taskBranch: 'emdash/task-two',
              workspaceId: 'worktree-workspace',
            },
          ]),
        }),
      });

    const resolvedTargets = await resolveAllProjectSettingsTargets(project as never);
    const targets = getProjectSettingsWriteTargets(resolvedTargets);
    const overrideState = await computeProjectSettingsOverrideState(resolvedTargets);

    expect(targets).toEqual([
      { type: 'project', label: 'Repo Name', path: '/repo' },
      {
        type: 'task',
        taskId: 'task-2',
        label: 'Task Two',
        path: '/repo/.emdash/worktrees/task-two',
      },
    ]);
    expect(getWorktree).not.toHaveBeenCalled();
    expect(overrideState.shellSetup).toEqual([
      { label: 'Repo Name', path: '/repo', value: 'root setup' },
      {
        label: 'Task Two',
        path: '/repo/.emdash/worktrees/task-two',
        value: 'worktree setup',
      },
    ]);
  });

  it('skips task target resolution when the project row no longer exists', async () => {
    const getWorktree = vi.fn();
    const project = {
      projectId: 'project-1',
      repoPath: '/repo',
      fs: {},
      defaultWorkspaceType: { kind: 'local' },
      worktreeService: {
        getWorktree,
      },
    };
    mocks.select.mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const targets = getProjectSettingsWriteTargets(
      await resolveAllProjectSettingsTargets(project as never)
    );

    expect(targets).toEqual([{ type: 'project', label: 'Project repository', path: '/repo' }]);
    expect(mocks.select).toHaveBeenCalledTimes(1);
    expect(getWorktree).not.toHaveBeenCalled();
  });

  it('detects workspace setting overrides from .emdash.json files', async () => {
    const project = {
      projectId: 'project-1',
      repoPath: '/repo',
      fs: {
        exists: vi.fn().mockResolvedValue(true),
        read: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            preservePatterns: ['.env', '.env.local'],
            shellSetup: 'nvm use',
            scripts: {
              setup: 'pnpm install',
              run: 'pnpm dev',
              teardown: 'docker compose down',
            },
          }),
        }),
      },
      defaultWorkspaceType: { kind: 'local' },
      worktreeService: {
        getWorktree: vi.fn(),
      },
    };
    mocks.select
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue([{ name: 'Repo Name' }]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

    await expect(
      computeProjectSettingsOverrideState(await resolveAllProjectSettingsTargets(project as never))
    ).resolves.toEqual({
      preservePatterns: [
        {
          label: 'Repo Name',
          path: '/repo',
          value: '.env\n.env.local',
        },
      ],
      shellSetup: [
        {
          label: 'Repo Name',
          path: '/repo',
          value: 'nvm use',
        },
      ],
      'scripts.setup': [
        {
          label: 'Repo Name',
          path: '/repo',
          value: 'pnpm install',
        },
      ],
      'scripts.run': [
        {
          label: 'Repo Name',
          path: '/repo',
          value: 'pnpm dev',
        },
      ],
      'scripts.teardown': [
        {
          label: 'Repo Name',
          path: '/repo',
          value: 'docker compose down',
        },
      ],
    });
  });
});
