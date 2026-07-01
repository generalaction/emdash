import { describe, expect, it } from 'vitest';
import type { LocalProjectSettings } from '@shared/core/app-settings';
import { normalizeSettingValueForStorage } from './settings-normalizers';

const invalidLocalProjectSettings: LocalProjectSettings = {
  defaultProjectsDirectory: '/tmp/emdash/repositories',
  defaultWorktreeDirectory: 'relative-worktrees',
  writeAgentConfigToGitIgnore: true,
};

describe('settings normalizers', () => {
  it('does not revalidate unchanged localProject defaultWorktreeDirectory when saving another field', async () => {
    const next = {
      ...invalidLocalProjectSettings,
      writeAgentConfigToGitIgnore: false,
    };

    await expect(
      normalizeSettingValueForStorage('localProject', next, invalidLocalProjectSettings)
    ).resolves.toEqual(next);
  });

  it('rejects invalid changed localProject defaultWorktreeDirectory values', async () => {
    await expect(
      normalizeSettingValueForStorage('localProject', invalidLocalProjectSettings, {
        ...invalidLocalProjectSettings,
        defaultWorktreeDirectory: '/tmp/emdash/worktrees',
      })
    ).rejects.toThrow('Invalid default worktree directory');
  });
});
