import { describe, expect, it } from 'vitest';
import { formatCronLabel, formatRunError } from './format';
import { parseCronToSchedule } from './schedule';

describe('automation schedule formatting', () => {
  it('does not treat 0,7 as a weekend schedule', () => {
    expect(formatCronLabel('0 9 * * 0,7')).toBe('0 9 * * 0,7');
    expect(parseCronToSchedule('0 9 * * 0,7')).toBeNull();
  });
});

describe('automation run error formatting', () => {
  it('formats configured action errors', () => {
    expect(formatRunError('action_invalid:2')).toBe(
      'One of the actions is not configured correctly'
    );
  });

  it('formats action-prefixed configured action errors', () => {
    expect(formatRunError('action_0_myaction:action_invalid:2')).toBe(
      'One of the actions is not configured correctly'
    );
  });

  it('formats restart recovery errors', () => {
    expect(formatRunError('interrupted_by_restart_task_preserved')).toBe(
      'The run was interrupted because the app restarted, but its agent was preserved'
    );
    expect(formatRunError('interrupted_by_restart_task_missing')).toBe(
      'The run was interrupted because the app restarted and its agent could not be found'
    );
  });
});
