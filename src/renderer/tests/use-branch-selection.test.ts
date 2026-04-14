import { describe, expect, it, vi } from 'vitest';
import { Branch } from '@shared/git';
import { resolveDefaultSelectedBranch } from '@renderer/features/tasks/create-task-modal/use-branch-selection';

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({ value: { pushOnCreate: true } }),
}));

describe('resolveDefaultSelectedBranch', () => {
  it('prefers matching local branch for the default branch', () => {
    const branches: Branch[] = [
      { type: 'remote', branch: 'main', remote: 'origin' },
      { type: 'local', branch: 'main' },
    ];

    expect(resolveDefaultSelectedBranch(branches, 'main')).toEqual({
      type: 'local',
      branch: 'main',
    });
  });

  it('falls back to matching remote branch when local does not exist', () => {
    const branches: Branch[] = [{ type: 'remote', branch: 'main', remote: 'origin' }];

    expect(resolveDefaultSelectedBranch(branches, 'main')).toEqual({
      type: 'remote',
      branch: 'main',
      remote: 'origin',
    });
  });

  it('returns undefined when the default branch does not exist locally or remotely', () => {
    const branches: Branch[] = [];

    expect(resolveDefaultSelectedBranch(branches, 'main')).toBeUndefined();
  });
});
