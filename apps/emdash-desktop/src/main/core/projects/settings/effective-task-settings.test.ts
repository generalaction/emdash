import type { IFileSystem } from '@emdash/core/files';
import { ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import { getEffectiveTaskSettings } from './effective-task-settings';
import type { ProjectSettingsProvider } from './provider';

function makeProjectSettings(settings: Awaited<ReturnType<ProjectSettingsProvider['get']>>) {
  return {
    get: vi.fn().mockResolvedValue(settings),
  } as unknown as ProjectSettingsProvider;
}

function makeTaskFs(config: unknown | null): Pick<IFileSystem, 'exists' | 'readText'> {
  return {
    exists: vi.fn(async () => ok(config !== null)),
    readText: vi.fn(async () =>
      ok({
        content: JSON.stringify(config),
        truncated: false,
        totalSize: 0,
      })
    ),
  };
}

describe('getEffectiveTaskSettings', () => {
  const taskConfigPath = '/worktree/.emdash.json';

  it('merges shareable project settings by leaf with project settings winning', async () => {
    const taskFs = makeTaskFs({
      scripts: { setup: 'pnpm install', run: 'npm run dev' },
      shellSetup: 'source .envrc',
      tmux: true,
      remote: 'upstream',
    });
    const settings = await getEffectiveTaskSettings({
      projectSettings: makeProjectSettings({
        preservePatterns: ['.env.local'],
        scripts: { run: 'pnpm dev' },
      }),
      taskFs,
      taskConfigPath,
    });

    expect(taskFs.exists).toHaveBeenCalledWith(taskConfigPath);
    expect(taskFs.readText).toHaveBeenCalledWith(taskConfigPath);
    expect(settings).toMatchObject({
      preservePatterns: ['.env.local'],
      shellSetup: 'source .envrc',
      scripts: {
        setup: 'pnpm install',
        run: 'pnpm dev',
      },
    });
    expect(settings).not.toHaveProperty('tmux');
    expect(settings).not.toHaveProperty('remote');
    expect(settings).not.toHaveProperty('baseRemote');
  });

  it('falls back to defaults plus project settings when the task config is invalid', async () => {
    const settings = await getEffectiveTaskSettings({
      projectSettings: makeProjectSettings({ shellSetup: 'nvm use' }),
      taskFs: {
        exists: vi.fn(async () => ok(true)),
        readText: vi.fn(async () => ok({ content: '{', truncated: false, totalSize: 1 })),
      },
      taskConfigPath,
    });

    expect(settings.preservePatterns).toContain('.env');
    expect(settings.preservePatterns).not.toContain('.emdash.json');
    expect(settings.shellSetup).toBe('nvm use');
  });

  it('falls back to project settings when the task config read is truncated', async () => {
    const settings = await getEffectiveTaskSettings({
      projectSettings: makeProjectSettings({
        scripts: { run: 'pnpm dev' },
      }),
      taskFs: {
        exists: vi.fn(async () => ok(true)),
        readText: vi.fn(async () =>
          ok({ content: '{"scripts":', truncated: true, totalSize: 204_801 })
        ),
      },
      taskConfigPath,
    });

    expect(settings.scripts?.run).toBe('pnpm dev');
  });

  it('falls back to defaults when project settings are invalid', async () => {
    const settings = await getEffectiveTaskSettings({
      projectSettings: makeProjectSettings({
        preservePatterns: 'not-an-array',
      } as never),
      taskFs: makeTaskFs(null),
      taskConfigPath,
    });

    expect(settings.preservePatterns).toContain('.env');
  });
});
