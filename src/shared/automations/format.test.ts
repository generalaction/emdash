import { describe, expect, it } from 'vitest';
import { formatCronLabel, parseCronToSchedule } from './format';

describe('automation schedule formatting', () => {
  it('does not treat 0,7 as a weekend schedule', () => {
    expect(formatCronLabel('0 9 * * 0,7')).toBe('0 9 * * 0,7');
    expect(parseCronToSchedule('0 9 * * 0,7')).toBeNull();
  });
});
