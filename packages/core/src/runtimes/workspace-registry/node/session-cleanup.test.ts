import { describe, expect, it, vi } from 'vitest';
import { LOCAL_HOST_REF } from '#primitives/host/api';
import { hostFileRef, parseNativeAbsolute } from '#primitives/path/api';
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

  it('counts and kills sessions under a Windows workspace path', async () => {
    const workspacePath = 'C:\\Users\\taehyun\\emdash\\task-1';
    const terminalPath = parseNativeAbsolute(`${workspacePath}\\src`);
    if (!terminalPath.success) throw new Error(terminalPath.error.message);
    const terminate = vi.fn().mockResolvedValue({ success: true, data: undefined });
    const kill = vi.fn().mockResolvedValue({ success: true, data: undefined });
    const clients = {
      acp: {
        sessions: {
          state: () => ({
            snapshot: async () => ({
              data: {
                active: {
                  conversationId: 'active',
                  cwd: `${workspacePath}\\src`,
                },
              },
            }),
          }),
        },
        terminate,
      },
      terminals: {
        sessions: {
          state: () => ({
            snapshot: async () => ({
              data: {
                terminal: {
                  key: {
                    id: 'terminal',
                    workspace: hostFileRef(LOCAL_HOST_REF, terminalPath.data),
                  },
                },
              },
            }),
          }),
        },
        kill,
      },
      tuiAgents: {
        sessions: { state: () => ({ snapshot: async () => ({ data: {} }) }) },
      },
    } as unknown as WorkspaceSessionClients;

    await expect(createSessionCounter(clients)(workspacePath)).resolves.toBe(2);
    await createSessionKiller(clients)(workspacePath);

    expect(terminate).toHaveBeenCalledWith({ conversationId: 'active' });
    expect(kill).toHaveBeenCalledTimes(1);
  });
});
