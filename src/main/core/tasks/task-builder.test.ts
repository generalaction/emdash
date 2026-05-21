import { describe, expect, it } from 'vitest';
import type { Conversation } from '@shared/conversations';
import type { Terminal } from '@shared/terminals';
import type { TaskViewSnapshot } from '@shared/view-state';
import { pickConversationsForHydration, pickTerminalsForHydration } from './hydration';

describe('task-builder hydration logic', () => {
  const conv1 = { id: 'c1', lastInteractedAt: '2023-01-01T00:00:00Z' } as Conversation;
  const conv2 = { id: 'c2', lastInteractedAt: '2023-01-02T00:00:00Z' } as Conversation;
  const conversations = [conv1, conv2];

  const term1 = { id: 't1' } as Terminal;
  const term2 = { id: 't2' } as Terminal;
  const terminals = [term1, term2];

  describe('pickConversationsForHydration', () => {
    it('returns all if length <= 1', () => {
      expect(pickConversationsForHydration([conv1], null)).toEqual([conv1]);
    });

    it('returns explicitly open conversations from snapshot (tabGroups)', () => {
      const snapshot: Partial<TaskViewSnapshot> = {
        tabGroups: {
          groups: [
            {
              tabManager: {
                tabs: [{ kind: 'conversation', conversationId: 'c2' } as any],
              } as any,
            } as any,
          ],
          activeGroupId: 'g1',
          paneSizes: [100],
        },
      };
      expect(pickConversationsForHydration(conversations, snapshot)).toEqual([conv2]);
    });

    it('returns explicitly open conversations from snapshot (legacy tabManager)', () => {
      const snapshot: Partial<TaskViewSnapshot> = {
        tabManager: {
          tabs: [{ kind: 'conversation', conversationId: 'c1' } as any],
        } as any,
      };
      expect(pickConversationsForHydration(conversations, snapshot)).toEqual([conv1]);
    });

    it('returns conversations from tabOrder', () => {
      const snapshot: Partial<TaskViewSnapshot> = {
        conversations: { tabOrder: ['c2'] } as any,
      };
      expect(pickConversationsForHydration(conversations, snapshot)).toEqual([conv2]);
    });

    it('falls back to most recent if open snapshot conversations are stale', () => {
      const snapshot: Partial<TaskViewSnapshot> = {
        tabManager: {
          tabs: [{ kind: 'conversation', conversationId: 'deleted' } as any],
        } as any,
      };
      expect(pickConversationsForHydration(conversations, snapshot)).toEqual([conv2]);
    });

    it('returns most recent if no snapshot is available', () => {
      // conv2 is more recent (Jan 2nd vs Jan 1st)
      expect(pickConversationsForHydration(conversations, null)).toEqual([conv2]);
    });
  });

  describe('pickTerminalsForHydration', () => {
    it('returns empty if no terminals', () => {
      expect(pickTerminalsForHydration([], null)).toEqual([]);
    });

    it('returns all if only one terminal', () => {
      expect(pickTerminalsForHydration([term1], null)).toEqual([term1]);
    });

    it('returns explicitly open terminals from tabOrder', () => {
      const snapshot: Partial<TaskViewSnapshot> = {
        terminals: { tabOrder: ['t2'] } as any,
      };
      expect(pickTerminalsForHydration(terminals, snapshot)).toEqual([term2]);
    });

    it('returns none if no snapshot is available', () => {
      expect(pickTerminalsForHydration(terminals, null)).toEqual([]);
    });
  });
});
