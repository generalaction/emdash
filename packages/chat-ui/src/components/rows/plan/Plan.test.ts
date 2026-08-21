import { describe, expect, it } from 'vitest';
import { planIsActive, visiblePlanEntryStatus } from './plan-status';

const IN_PROGRESS_ENTRY = {
  content: 'Implement the fix',
  status: 'in_progress' as const,
  priority: 'high' as const,
};

describe('planIsActive', () => {
  it('honors an explicit activity override', () => {
    expect(
      planIsActive({ kind: 'plan', id: 'active', entries: [IN_PROGRESS_ENTRY], active: true })
    ).toBe(true);
    expect(
      planIsActive({ kind: 'plan', id: 'inactive', entries: [IN_PROGRESS_ENTRY], active: false })
    ).toBe(false);
  });

  it('falls back to streaming and entry statuses for legacy plans', () => {
    expect(
      planIsActive({
        kind: 'plan',
        id: 'legacy-streaming',
        entries: [],
        streaming: true,
      })
    ).toBe(true);
    expect(
      planIsActive({
        kind: 'plan',
        id: 'legacy-progress',
        entries: [IN_PROGRESS_ENTRY],
        streaming: false,
      })
    ).toBe(true);
  });
});

describe('visiblePlanEntryStatus', () => {
  it('shows an in-progress step as inactive after its plan becomes inactive', () => {
    expect(visiblePlanEntryStatus('in_progress', false)).toBe('inactive');
  });

  it('preserves running and completed step statuses in an active plan', () => {
    expect(visiblePlanEntryStatus('in_progress', true)).toBe('in_progress');
    expect(visiblePlanEntryStatus('completed', true)).toBe('completed');
  });
});
