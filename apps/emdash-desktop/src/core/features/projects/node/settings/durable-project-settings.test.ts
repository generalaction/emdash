import { describe, expect, it, vi } from 'vitest';
import { DesktopProjectSettingsAuthority } from './durable-project-settings';
import type { ProjectSettingsStorage, StoredProjectSettings } from './project-settings-storage';

describe('DesktopProjectSettingsAuthority', () => {
  it('normalizes an ancient account pin before applying a different provider patch', async () => {
    const row: StoredProjectSettings = {
      baseProjectSettingsJson: JSON.stringify({ githubAccountId: 'github.com:42' }),
      shareableProjectSettingsJson: '{}',
      legacyConfigMigratedAt: null,
    };
    const authority = new DesktopProjectSettingsAuthority({
      get: vi.fn(async () => row),
      insertIfMissing: vi.fn(),
      mutate: vi.fn(async (_id, patch) => {
        Object.assign(row, patch(row));
        return row;
      }),
    });
    await expect(authority.read('project-1')).resolves.toMatchObject({
      success: true,
      data: {
        gitIdentity: { stored: {} },
        integrationAccounts: {
          stored: { github: { kind: 'account', accountId: 'github.com:42' } },
        },
      },
    });
    await authority.patch('project-1', {
      integrationAccounts: { stored: { jira: { kind: 'none' } } },
    });
    expect(JSON.parse(row.baseProjectSettingsJson)).toEqual({
      integrationAccounts: {
        github: { kind: 'account', accountId: 'github.com:42' },
        jira: { kind: 'none' },
      },
    });
  });

  it('reads and patches desktop-owned settings without a Project Provider', async () => {
    const row: StoredProjectSettings = {
      baseProjectSettingsJson: JSON.stringify({
        worktreeRoot: '/tmp/worktrees',
        baseRemote: 'origin',
        tmux: true,
      }),
      shareableProjectSettingsJson: '{}',
      legacyConfigMigratedAt: null,
    };
    const storage: ProjectSettingsStorage = {
      get: vi.fn(async () => row),
      insertIfMissing: vi.fn(),
      mutate: vi.fn(async (_projectId, patch) => {
        Object.assign(row, patch(row));
        return row;
      }),
    };
    const authority = new DesktopProjectSettingsAuthority(storage);

    await expect(authority.read('project-1')).resolves.toMatchObject({
      success: true,
      data: {
        gitIdentity: { stored: { baseRemote: 'origin' } },
        placement: { stored: { worktreeRoot: '/tmp/worktrees', tmux: true } },
      },
    });

    await expect(
      authority.patch('project-1', {
        gitIdentity: { stored: { pushRemote: 'fork', baseRemote: null } },
        placement: { stored: { tmux: false } },
      })
    ).resolves.toEqual({ success: true, data: undefined });

    expect(JSON.parse(row.baseProjectSettingsJson)).toMatchObject({
      worktreeRoot: '/tmp/worktrees',
      pushRemote: 'fork',
      tmux: false,
    });
    expect(JSON.parse(row.baseProjectSettingsJson)).not.toHaveProperty('baseRemote');
  });

  it('preserves lifecycle migration sources during a durable patch', async () => {
    const shareable = JSON.stringify({
      preservePatterns: ['.env.local'],
      scripts: { setup: 'pnpm install' },
    });
    const row: StoredProjectSettings = {
      baseProjectSettingsJson: JSON.stringify({
        baseRemote: 'origin',
        autoRunSetupScriptOnTaskCreation: false,
        autoRunRunScriptOnTaskCreation: true,
      }),
      shareableProjectSettingsJson: shareable,
      legacyConfigMigratedAt: null,
    };
    const storage: ProjectSettingsStorage = {
      get: vi.fn(async () => row),
      insertIfMissing: vi.fn(),
      mutate: vi.fn(async (_projectId, patch) => {
        Object.assign(row, patch(row));
        return row;
      }),
    };
    const authority = new DesktopProjectSettingsAuthority(storage);

    await authority.patch('project-1', {
      gitIdentity: { stored: { pushRemote: 'fork' } },
    });

    expect(JSON.parse(row.baseProjectSettingsJson)).toEqual({
      baseRemote: 'origin',
      pushRemote: 'fork',
      autoRunSetupScriptOnTaskCreation: false,
      autoRunRunScriptOnTaskCreation: true,
    });
    expect(row.shareableProjectSettingsJson).toBe(shareable);
  });
});
