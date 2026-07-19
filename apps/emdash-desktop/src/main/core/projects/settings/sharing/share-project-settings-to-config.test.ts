import { err, ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import type { ShareableProjectSettings } from '@core/primitives/project-settings/api';
import { filesClientScope, type FilesClientScope } from '@main/core/files/runtime-client';
import { computeProjectSettingsOverrideState } from './project-settings-override-state';
import {
  getProjectSettingsWriteTargets,
  resolveAllProjectSettingsTargets,
} from './project-settings-target-resolver';
import { shareProjectSettingsToConfig } from './share-project-settings-to-config';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  workspaceGet: vi.fn(),
}));

vi.mock('@core/features/workspaces/node/workspace-identity-source', () => ({
  workspaceIdentityService: {
    resolve: mocks.workspaceGet,
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

vi.mock('@main/lib/logger', () => {
  const log = {
    child: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  log.child.mockImplementation(() => log);
  return { log };
});

const repoPath = '/repo';
const configPath = `${repoPath}/.emdash.json`;

function createMemoryFileSystem(initialFiles: Record<string, string> = {}) {
  const files = new Map(
    Object.entries(initialFiles).map(([filePath, content]) => [
      filePath.startsWith('/') ? filePath : `${repoPath}/${filePath}`,
      content,
    ])
  );
  const exists = vi.fn(async (filePath: string) => ok(files.has(filePath)));
  const readText = vi.fn(async (filePath: string) => {
    const content = files.get(filePath);
    if (content === undefined) {
      return err({
        type: 'not-found' as const,
        path: filePath,
      });
    }
    return ok({
      content,
      truncated: false,
      totalSize: Buffer.byteLength(content),
      etag: 'test-etag',
    });
  });
  const writeText = vi.fn(async (filePath: string, content: string) => {
    files.set(filePath, content);
    return ok({ bytesWritten: Buffer.byteLength(content) });
  });
  const resolve = (relative: string, root = repoPath) => joinPath(root, relative);
  const clientReadText = vi.fn(
    ({ root, relative }: { root: Parameters<typeof nativePathFromHost>[0]; relative: string }) =>
      readText(resolve(relative, nativePathFromHost(root)))
  );
  const writeFile = vi.fn(
    ({
      root,
      path,
      content,
    }: {
      root: Parameters<typeof nativePathFromHost>[0];
      path: string;
      content: string;
    }) =>
      writeText(resolve(path, nativePathFromHost(root)), content).then((result) =>
        result.success ? ok(undefined) : result
      )
  );
  const scope = filesClientScope(
    {
      fs: {
        exists: ({
          root,
          relative,
        }: {
          root: Parameters<typeof nativePathFromHost>[0];
          relative: string;
        }) => exists(resolve(relative, nativePathFromHost(root))),
        readText: clientReadText,
      },
      mutations: { writeFile },
    } as never,
    repoPath
  );
  return Object.assign(scope, {
    exists,
    readText,
    writeText,
    content(filePath: string) {
      return files.get(filePath) ?? files.get(`${repoPath}/${filePath}`);
    },
  });
}

function joinPath(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/');
}

function configPathForDirectory(directoryPath: string): string {
  return joinPath(directoryPath, '.emdash.json');
}

function projectFixture(files: FilesClientScope, overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'project-1',
    repoPath,
    files,
    projectConfigPath: configPath,
    resolveProjectPath: (relativePath: string) => joinPath(repoPath, relativePath),
    configPathForDirectory,
    defaultWorkspaceType: { kind: 'local' },
    ...overrides,
  };
}

function projectTarget(files: FilesClientScope) {
  return { type: 'project' as const, label: 'Repo Name', path: repoPath, files, configPath };
}

describe('shareProjectSettingsToConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workspaceGet.mockReturnValue(undefined);
  });

  it('writes selected shareable project settings to .emdash.json', async () => {
    const fileSystem = createMemoryFileSystem();
    const write = fileSystem.writeText;
    const patch = vi.fn().mockResolvedValue({ success: true });
    const project = {
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
      [projectTarget(fileSystem)]
    );

    expect(result.success).toBe(true);
    expect(write).toHaveBeenCalledWith(
      configPath,
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
    const fileSystem = createMemoryFileSystem();
    let shareableSettings: ShareableProjectSettings = {
      preservePatterns: ['.env', '.env.local'],
    };
    const project = {
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
    const targets = [projectTarget(fileSystem)];

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
    expect(JSON.parse(fileSystem.content('.emdash.json') ?? '{}')).toEqual({
      preservePatterns: ['.env', '.env.local'],
      scripts: {
        run: 'pnpm dev',
      },
    });
  });

  it('only clears fields that were actually written to .emdash.json', async () => {
    const fileSystem = createMemoryFileSystem({
      '.emdash.json': JSON.stringify({ preservePatterns: ['.env'] }),
    });
    const write = fileSystem.writeText;
    const patch = vi.fn().mockResolvedValue({ success: true });
    const project = {
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
      [projectTarget(fileSystem)]
    );

    expect(result.success).toBe(true);
    expect(write).toHaveBeenCalledWith(
      configPath,
      `${JSON.stringify({ preservePatterns: ['.env.local'] }, null, 2)}\n`
    );
    expect(patch).toHaveBeenCalledWith({
      clearShareableFields: ['preservePatterns'],
    });
  });

  it('returns an error when the filesystem reports an unsuccessful write', async () => {
    const patch = vi.fn();
    const fileSystem = createMemoryFileSystem();
    vi.mocked(fileSystem.client.mutations.writeFile).mockResolvedValue(
      err({ type: 'io' as const, path: '.emdash.json', message: 'permission denied' })
    );
    const project = {
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
      [projectTarget(fileSystem)]
    );

    expect(result).toEqual({
      success: false,
      error: {
        type: 'write-config-failed',
        message: 'Could not write .emdash.json: permission denied',
      },
    });
    expect(patch).not.toHaveBeenCalled();
  });

  it('returns an error when clearing shared fields fails after writing config', async () => {
    const fileSystem = createMemoryFileSystem({
      '.emdash.json': `${JSON.stringify({ shellSetup: 'old setup' }, null, 2)}\n`,
    });
    const write = fileSystem.writeText;
    const patch = vi.fn().mockResolvedValue({
      success: false,
      error: { type: 'error' },
    });
    const project = {
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
      [projectTarget(fileSystem)]
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
    const fileSystem = createMemoryFileSystem({ '.emdash.json': '{ invalid json' });
    const project = {
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
      [projectTarget(fileSystem)]
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

  it('does not overwrite an existing .emdash.json when the read is truncated', async () => {
    const fileSystem = createMemoryFileSystem({ '.emdash.json': '{"shellSetup":' });
    vi.mocked(fileSystem.client.fs.readText).mockResolvedValue(
      ok({
        content: '{"shellSetup":',
        truncated: true,
        totalSize: 204_801,
        etag: 'test-etag',
      })
    );
    const project = {
      settings: {
        get: vi.fn().mockResolvedValue({
          preservePatterns: ['.env'],
        }),
        patch: vi.fn(),
      },
    };

    const result = await shareProjectSettingsToConfig(
      project as never,
      {
        target: { type: 'project' },
        fields: ['preservePatterns'],
      },
      [projectTarget(fileSystem)]
    );

    expect(result).toEqual({
      success: false,
      error: {
        type: 'write-config-failed',
        message: 'Could not read existing .emdash.json: file was truncated.',
      },
    });
    expect(fileSystem.writeText).not.toHaveBeenCalled();
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

  it('includes task worktrees from git branch discovery, not only active workspaces', async () => {
    const findBranchAnywhere = vi.fn().mockResolvedValue('/external/worktrees/task-one');
    const projectFs = createMemoryFileSystem();
    const project = projectFixture(projectFs, {
      worktreeService: {
        findBranchAnywhere,
      },
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
          leftJoin: () => ({
            where: vi.fn().mockResolvedValue([
              {
                id: 'task-1',
                name: 'Task One',
                workspaceBranchName: 'emdash/task-one',
                workspaceId: null,
              },
            ]),
          }),
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
        path: '/external/worktrees/task-one',
      },
    ]);
    expect(findBranchAnywhere).toHaveBeenCalledWith('emdash/task-one');
  });

  it('excludes task targets that use the project root working directory', async () => {
    const projectRootFs = createMemoryFileSystem({
      '.emdash.json': JSON.stringify({ shellSetup: 'root setup' }),
      '/repo/.emdash/worktrees/task-two/.emdash.json': JSON.stringify({
        shellSetup: 'worktree setup',
      }),
    });
    const findBranchAnywhere = vi.fn();
    const project = projectFixture(projectRootFs, {
      worktreeService: {
        findBranchAnywhere,
      },
    });
    mocks.workspaceGet.mockImplementation((workspaceId: string) => {
      if (workspaceId === 'root-workspace') {
        return { workspaceId, projectId: 'project-1', path: '/repo' };
      }
      if (workspaceId === 'worktree-workspace') {
        return {
          workspaceId,
          projectId: 'project-1',
          path: '/repo/.emdash/worktrees/task-two',
        };
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
          leftJoin: () => ({
            where: vi.fn().mockResolvedValue([
              {
                id: 'task-1',
                name: 'Root Task',
                workspaceBranchName: null,
                workspaceId: 'root-workspace',
              },
              {
                id: 'task-2',
                name: 'Task Two',
                workspaceBranchName: 'emdash/task-two',
                workspaceId: 'worktree-workspace',
              },
            ]),
          }),
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
    expect(findBranchAnywhere).not.toHaveBeenCalled();
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
    const findBranchAnywhere = vi.fn();
    const projectFs = createMemoryFileSystem();
    const project = projectFixture(projectFs, {
      worktreeService: {
        findBranchAnywhere,
      },
    });
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
    expect(findBranchAnywhere).not.toHaveBeenCalled();
  });

  it('detects workspace setting overrides from .emdash.json files', async () => {
    const projectFs = createMemoryFileSystem({
      '.emdash.json': JSON.stringify({
        preservePatterns: ['.env', '.env.local'],
        shellSetup: 'nvm use',
        scripts: {
          setup: 'pnpm install',
          run: 'pnpm dev',
          teardown: 'docker compose down',
        },
      }),
    });
    const project = projectFixture(projectFs, {
      worktreeService: {
        findBranchAnywhere: vi.fn(),
      },
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
          leftJoin: () => ({
            where: vi.fn().mockResolvedValue([]),
          }),
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
