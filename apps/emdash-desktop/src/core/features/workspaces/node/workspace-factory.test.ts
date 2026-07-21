import { describe, expect, it, vi } from 'vitest';
import { buildTaskProviders } from '@core/features/workspaces/api/node/workspace-factory';

vi.mock('@core/features/conversations/node/tui-conversation-provider', () => ({
  TuiConversationProvider: class {},
}));

vi.mock('@core/features/projects/api/node/settings/effective-task-settings', () => ({
  getEffectiveTaskSettings: vi.fn(),
}));

describe('buildTaskProviders', () => {
  it('returns a typed host-unavailable error for remote workspaces', async () => {
    await expect(
      buildTaskProviders(
        { kind: 'ssh', connectionId: 'ssh-1' },
        {
          projectId: 'project-1',
          taskId: 'task-1',
          workspaceId: 'workspace-1',
          taskPath: '/remote/worktree',
          tmuxEnabled: false,
          taskEnvVars: {},
        },
        vi.fn()
      )
    ).resolves.toEqual({
      success: false,
      error: {
        type: 'host-unavailable',
        host: { type: 'remote', id: 'ssh-1' },
        message:
          'Remote workspaces require the workspace server and are not supported by this build',
      },
    });
  });
});
