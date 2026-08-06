import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@main/db/client';
import { getPersistedLoopSessionPurpose, requiresExplicitLoopTarget } from './loop-session-purpose';

const whereMock = vi.hoisted(() => vi.fn());

vi.mock('@main/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: whereMock })),
    })),
  },
}));

describe('Loop session purpose lookup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('finds historical attempts rather than only the phase conversation pointer', async () => {
    whereMock.mockResolvedValue([
      {
        state: {
          version: '2',
          sessionAttempts: [
            { conversationId: 'old-e2e', purpose: 'e2e' },
            { conversationId: 'current-work', purpose: 'work' },
          ],
        },
      },
    ]);

    await expect(getPersistedLoopSessionPurpose('task-1', 'old-e2e')).resolves.toBe('e2e');
    expect(db.select).toHaveBeenCalledOnce();
  });

  it.each(['e2e', 'browser-verification'] as const)(
    'requires an explicit target for %s sessions',
    (purpose) => expect(requiresExplicitLoopTarget(purpose)).toBe(true)
  );

  it('allows ordinary and work/review hydration', () => {
    expect(requiresExplicitLoopTarget(null)).toBe(false);
    expect(requiresExplicitLoopTarget('work')).toBe(false);
    expect(requiresExplicitLoopTarget('review')).toBe(false);
  });
});
