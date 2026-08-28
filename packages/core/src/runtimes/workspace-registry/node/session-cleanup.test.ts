import { describe, expect, it, vi } from 'vitest';
import {
  createSessionCounter,
  createSessionKiller,
  type WorkspaceSessionClients,
} from './session-cleanup';

describe('workspace session cleanup', () => {
  it('kills suspended ACP entries but excludes them from active session counts', async () => {
    const terminate = vi.fn().mockResolvedValue({ success: true, data: undefined });
    const clients = {
      acp: {
        sessions: {
          state: () => ({
            snapshot: async () => ({
              data: {
                active: {
                  conversationId: 'active',
                  cwd: '/workspace/repo',
                },
                suspended: {
                  conversationId: 'suspended',
                  cwd: '/workspace/repo',
                  suspended: true,
                },
              },
            }),
          }),
        },
        terminate,
      },
      terminals: {
        sessions: { state: () => ({ snapshot: async () => ({ data: {} }) }) },
      },
      tuiAgents: {
        sessions: { state: () => ({ snapshot: async () => ({ data: {} }) }) },
      },
    } as unknown as WorkspaceSessionClients;

    await expect(createSessionCounter(clients)('/workspace/repo')).resolves.toBe(1);
    await createSessionKiller(clients)('/workspace/repo');

    expect(terminate).toHaveBeenCalledTimes(2);
    expect(terminate).toHaveBeenCalledWith({ conversationId: 'active' });
    expect(terminate).toHaveBeenCalledWith({ conversationId: 'suspended' });
  });
});
