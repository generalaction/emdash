import type { ChatPlan } from '../../model';

export const planFixtures: ChatPlan[] = [
  // Empty plan (streaming start)
  {
    kind: 'plan',
    id: 'plan-1',
    streaming: true,
    entries: [],
  },
  // Small plan, collapsed default
  {
    kind: 'plan',
    id: 'plan-2',
    streaming: false,
    entries: [
      { content: 'Set up project structure', status: 'completed', priority: 'high' },
      { content: 'Add authentication', status: 'in_progress', priority: 'medium' },
      { content: 'Write tests', status: 'pending', priority: 'low' },
    ],
  },
  // Larger plan (enough entries to cap the preview window)
  {
    kind: 'plan',
    id: 'plan-3',
    streaming: false,
    entries: Array.from({ length: 8 }, (_, i) => ({
      content: `Task ${i + 1}: complete the feature step`,
      status: (i < 3 ? 'completed' : 'pending') as 'completed' | 'pending',
      priority: 'medium' as const,
    })),
  },
];
