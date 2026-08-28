import { describe, expect, it, vi } from 'vitest';
import type { ConversationConfig } from '@core/primitives/conversations/api';
import type { HostConversationMutationDeps } from './host-mutation';
import { setConversationAcpConfigOption } from './set-acp-config-option';

describe('setConversationAcpConfigOption', () => {
  it('persists model and effort and can clear an unsupported stored selection', async () => {
    const { deps, hostCalls } = fakeDeps({
      version: '1',
      type: 'acp',
      model: 'old-model',
      modeId: 'agent',
    });

    await expect(
      setConversationAcpConfigOption(deps, 'conversation-1', 'effort', 'high')
    ).resolves.toMatchObject({ success: true, data: { changed: true } });
    expect(hostCalls.at(-1)?.config).toMatchObject({ effort: 'high' });

    const clearing = fakeDeps({
      version: '1',
      type: 'acp',
      model: 'unsupported-model',
      modeId: 'agent',
    });
    await setConversationAcpConfigOption(clearing.deps, 'conversation-1', 'model', null);
    expect(clearing.hostCalls.at(-1)?.config).toEqual({
      version: '1',
      type: 'acp',
      modeId: 'agent',
    });
  });
});

function fakeDeps(config: ConversationConfig) {
  const hostCalls: Array<{ conversationId: string; config: ConversationConfig }> = [];
  const host = {
    updateConfig: vi.fn(async (input: { conversationId: string; config: ConversationConfig }) => {
      hostCalls.push(input);
      return { success: true as const, data: { ...input, updatedAt: Date.now() } };
    }),
  };
  const database = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [
            {
              config,
              projectId: 'project-1',
              taskId: 'task-1',
              location: 'local',
              sshConnectionId: null,
            },
          ],
        }),
      }),
    }),
    update: () => ({
      set: () => ({ where: () => ({ run: () => ({ changes: 1 }) }) }),
    }),
  };
  const deps: HostConversationMutationDeps = {
    db: database as never,
    runtimes: {
      client: vi.fn(async () => ({
        success: true as const,
        data: { conversations: host },
      })),
    } as never,
    hostIsReachable: () => true,
  };
  return { deps, hostCalls };
}
