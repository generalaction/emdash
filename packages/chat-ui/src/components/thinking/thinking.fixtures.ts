import type { ChatThinking } from '../../model';

export const thinkingFixtures: ChatThinking[] = [
  // Active thinking (status=thinking, not expanded → shows preview window)
  {
    kind: 'thinking',
    id: 'th-1',
    status: 'thinking',
    startedAt: Date.now() - 3000,
    text: 'Let me think about this problem carefully. I need to consider the edge cases...',
    durationMs: undefined,
  },
  // Done thinking, not expanded → header only
  {
    kind: 'thinking',
    id: 'th-2',
    status: 'done',
    startedAt: Date.now() - 5000,
    text: 'The solution is to use a binary search algorithm.',
    durationMs: 5000,
  },
];
