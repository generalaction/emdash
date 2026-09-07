import { ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import { buildTaskProviders } from '@core/features/workspaces/api/node/workspace-factory';

describe('buildTaskProviders', () => {
  it('constructs providers for a remote host with its injected runtime clients', async () => {
    const conversations = {};
    const files = { client: {}, root: {} } as never;
    const tuiAgents = {};
    const options = {
      host: { type: 'remote' as const, id: 'ssh-1' },
      files,
      tuiAgents: tuiAgents as never,
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      taskPath: '/remote/worktree',
      launchContextSource: {
        resolve: async () =>
          ok({
            workspace: {
              workspaceId: 'workspace-1',
              projectId: 'project-1',
              host: { type: 'remote' as const, id: 'ssh-1' },
              path: '/remote/worktree',
            },
            tmux: false,
            env: {},
          }),
      },
    };
    const createConversationProvider = vi.fn(() => conversations as never);

    const result = await buildTaskProviders(options, createConversationProvider);

    expect(result).toEqual({
      success: true,
      data: { conversations },
    });
    expect(createConversationProvider).toHaveBeenCalledWith(options);
  });
});
