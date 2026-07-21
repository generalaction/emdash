import { ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import { getEffectiveTaskSettings } from '@core/features/projects/api/node/settings/effective-task-settings';
import type { ProjectSettingsProvider } from '@core/features/projects/api/node/settings/provider';
import { filesClientScope } from '@core/services/runtime-broker/node/files';

function makeProjectSettings(settings: Awaited<ReturnType<ProjectSettingsProvider['get']>>) {
  return {
    get: vi.fn().mockResolvedValue(settings),
  } as unknown as ProjectSettingsProvider;
}

function makeTaskFiles(config: unknown | null) {
  const exists = vi.fn(async () => ok(config !== null));
  const readText = vi.fn(async () =>
    ok({
      content: JSON.stringify(config),
      truncated: false,
      totalSize: 0,
      etag: 'test-etag',
    })
  );
  return {
    files: filesClientScope({ fs: { exists, readText } } as never, '/worktree'),
    exists,
    readText,
  };
}

function taskFilesWith(exists: ReturnType<typeof vi.fn>, readText: ReturnType<typeof vi.fn>) {
  return filesClientScope({ fs: { exists, readText } } as never, '/worktree');
}

describe('getEffectiveTaskSettings', () => {
  const taskConfigPath = '/worktree/.emdash.json';

  it('merges shareable project settings by leaf with project settings winning', async () => {
    const taskFiles = makeTaskFiles({
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
      taskFiles: taskFiles.files,
      taskConfigPath,
    });

    expect(taskFiles.exists).toHaveBeenCalledWith(
      expect.objectContaining({ relative: '.emdash.json' })
    );
    expect(taskFiles.readText).toHaveBeenCalledWith(
      expect.objectContaining({ relative: '.emdash.json' })
    );
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
      taskFiles: taskFilesWith(
        vi.fn(async () => ok(true)),
        vi.fn(async () => ok({ content: '{', truncated: false, totalSize: 1, etag: 'test-etag' }))
      ),
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
      taskFiles: taskFilesWith(
        vi.fn(async () => ok(true)),
        vi.fn(async () =>
          ok({
            content: '{"scripts":',
            truncated: true,
            totalSize: 204_801,
            etag: 'test-etag',
          })
        )
      ),
      taskConfigPath,
    });

    expect(settings.scripts?.run).toBe('pnpm dev');
  });

  it('falls back to defaults when project settings are invalid', async () => {
    const settings = await getEffectiveTaskSettings({
      projectSettings: makeProjectSettings({
        preservePatterns: 'not-an-array',
      } as never),
      taskFiles: makeTaskFiles(null).files,
      taskConfigPath,
    });

    expect(settings.preservePatterns).toContain('.env');
  });
});
