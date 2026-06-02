import { describe, expect, it } from 'vitest';
import { formatCronLabel, formatRunError } from './format';
import { parseCronToSchedule } from './schedule';

describe('automation schedule formatting', () => {
  it('formats hourly schedules', () => {
    expect(formatCronLabel('0 * * * *')).toBe('Hourly');
    expect(parseCronToSchedule('0 * * * *')).toEqual({ kind: 'hourly', minute: 0 });
  });

  it('formats daily schedules', () => {
    expect(formatCronLabel('0 9 * * *')).toBe('Daily · 9 AM');
    expect(parseCronToSchedule('0 9 * * *')).toEqual({ kind: 'daily', hour: 9, minute: 0 });
  });

  it('formats weekly schedules', () => {
    expect(formatCronLabel('0 9 * * MON')).toBe('Mondays · 9 AM');
    expect(parseCronToSchedule('0 9 * * MON')).toEqual({
      kind: 'weekly',
      hour: 9,
      minute: 0,
      weekday: 'MON',
    });
  });

  it('formats monthly schedules', () => {
    expect(formatCronLabel('0 9 1 * *')).toBe('Monthly · 1st · 9 AM');
  });

  it('formats interval schedules', () => {
    expect(formatCronLabel('*/15 * * * *')).toBe('Every 15 min');
    expect(parseCronToSchedule('*/15 * * * *')).toEqual({
      kind: 'interval',
      intervalMinutes: 15,
    });
  });

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

  it('formats queue deadline errors', () => {
    expect(formatRunError('queue_deadline_exceeded')).toBe(
      'Skipped because it waited in the queue for too long'
    );
    expect(formatRunError('action_0_task:queue_deadline_exceeded')).toBe(
      'Skipped because it waited in the queue for too long'
    );
  });

  it('formats provisioning timeout errors', () => {
    expect(formatRunError('provisioning timed out after 60000ms')).toBe(
      'Setting up the task took too long and timed out'
    );
    expect(formatRunError('action_0_task:provisioning timed out after 60000ms')).toBe(
      'Setting up the task took too long and timed out'
    );
  });
});
