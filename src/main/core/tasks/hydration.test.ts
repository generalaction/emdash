import { describe, expect, it } from 'vitest';
import type { TaskViewSnapshot } from '@shared/view-state';
import { getConversationIdsForInitialHydration } from './hydration';

describe('getConversationIdsForInitialHydration', () => {
  it('returns conversations from multi-pane tab groups', () => {
    const snapshot: Partial<TaskViewSnapshot> = {
      tabGroups: {
        activeGroupId: 'g1',
        paneSizes: [50, 50],
        groups: [
          {
            groupId: 'g1',
            tabManager: {
              activeTabId: 'tab-1',
              tabs: [
                {
                  kind: 'conversation',
                  tabId: 'tab-1',
                  conversationId: 'conv-1',
                  isPreview: false,
                },
                { kind: 'file', tabId: 'tab-2', path: 'README.md', isPreview: false },
              ],
            },
          },
          {
            groupId: 'g2',
            tabManager: {
              activeTabId: 'tab-3',
              tabs: [
                {
                  kind: 'conversation',
                  tabId: 'tab-3',
                  conversationId: 'conv-2',
                  isPreview: true,
                },
              ],
            },
          },
        ],
      },
    };

    expect([...getConversationIdsForInitialHydration(snapshot)]).toEqual(['conv-1', 'conv-2']);
  });

  it('supports legacy conversation tab snapshots', () => {
    const snapshot: Partial<TaskViewSnapshot> = {
      conversations: {
        tabOrder: ['conv-legacy'],
        activeTabId: 'conv-legacy',
      },
    };

    expect([...getConversationIdsForInitialHydration(snapshot)]).toEqual(['conv-legacy']);
  });

  it('does not invent fallback conversations when no conversation tabs are persisted', () => {
    expect([...getConversationIdsForInitialHydration(null)]).toEqual([]);
    expect([...getConversationIdsForInitialHydration({})]).toEqual([]);
  });
});
