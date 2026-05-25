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

  it('does not normalize unshipped action-prefixed errors', () => {
    expect(formatRunError('action_0_myaction:action_invalid:2')).toBe(
      'action_0_myaction:action_invalid:2'
    );
  });
});
