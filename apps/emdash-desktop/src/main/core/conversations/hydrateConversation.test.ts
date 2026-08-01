import { beforeEach, describe, expect, it, vi } from 'vitest';
import { acpSessionManager } from '@main/core/acp/production-acp-session-manager';
import { getPersistedLoopSessionPurpose } from '@main/core/loops/operations/loop-session-purpose';
import { resolveTaskWorkspaceTarget } from '@main/core/workspaces/resolve-task-workspace-target';
import { hydrateConversation, LoopConversationHydrationError } from './hydrateConversation';

const limitMock = vi.hoisted(() => vi.fn());

vi.mock('@main/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: limitMock })),
      })),
    })),
  },
}));

vi.mock('@main/core/loops/operations/loop-session-purpose', () => ({
  getPersistedLoopSessionPurpose: vi.fn(),
  requiresExplicitLoopTarget: (purpose: string | null) =>
    purpose === 'e2e' || purpose === 'browser-verification',
}));

vi.mock('@main/core/acp/production-acp-session-manager', () => ({
  acpSessionManager: { isRunning: vi.fn(), start: vi.fn() },
}));

vi.mock('@main/core/workspaces/resolve-task-workspace-target', () => ({
  resolveTaskWorkspaceTarget: vi.fn(),
}));

vi.mock('../projects/utils', () => ({ resolveTask: vi.fn() }));

describe('hydrateConversation Loop target guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limitMock.mockResolvedValue([
      {
        id: 'conversation-e2e',
        projectId: 'project-1',
        taskId: 'task-1',
        type: 'acp',
      },
    ]);
  });

  it.each(['e2e', 'browser-verification'] as const)(
    'rejects historical %s conversations before normal task hydration',
    async (purpose) => {
      vi.mocked(getPersistedLoopSessionPurpose).mockResolvedValue(purpose);

      const hydration = hydrateConversation('project-1', 'task-1', 'conversation-e2e');

      await expect(hydration).rejects.toMatchObject({
        name: 'LoopConversationHydrationError',
        code: 'loop-explicit-target-required',
        conversationId: 'conversation-e2e',
        purpose,
      } satisfies Partial<LoopConversationHydrationError>);
      expect(resolveTaskWorkspaceTarget).not.toHaveBeenCalled();
      expect(acpSessionManager.start).not.toHaveBeenCalled();
    }
  );
});
