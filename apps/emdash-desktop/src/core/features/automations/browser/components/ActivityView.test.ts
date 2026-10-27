import type { Automation, AutomationRun } from '@core/primitives/automations/api';
import { describe, expect, it } from 'vitest';
import { getActivityStatus, type ActivityItem } from './ActivityView';

describe('ActivityView', () => {
  describe('getActivityStatus', () => {
    it('prioritizes failed run status or agent error', () => {
      expect(getActivityStatus('failed', null)).toBe('failed');
      expect(getActivityStatus('failed', 'working')).toBe('failed');
      expect(getActivityStatus('done', 'error')).toBe('failed');
    });

    it('identifies awaiting-input when agent requires attention', () => {
      expect(getActivityStatus('done', 'awaiting-input')).toBe('awaiting-input');
      expect(getActivityStatus('starting_session', 'awaiting-input')).toBe('awaiting-input');
    });

    it('treats provisioning, starting session, or active agent as working', () => {
      expect(getActivityStatus('provisioning_workspace', null)).toBe('working');
      expect(getActivityStatus('starting_session', null)).toBe('working');
      expect(getActivityStatus('done', 'working')).toBe('working');
    });

    it('preserves queued, cancelled, and skipped statuses', () => {
      expect(getActivityStatus('queued', null)).toBe('queued');
      expect(getActivityStatus('cancelled', null)).toBe('cancelled');
      expect(getActivityStatus('skipped', null)).toBe('skipped');
    });

    it('returns done when run is finished and agent is completed or idle', () => {
      expect(getActivityStatus('done', 'completed')).toBe('done');
      expect(getActivityStatus('done', 'idle')).toBe('done');
      expect(getActivityStatus('done', null)).toBe('done');
    });
  });

  describe('ActivityItem sorting', () => {
    it('sorts activity items by timestamp descending', () => {
      const items: ActivityItem[] = [
        {
          run: fakeRun('run-1', 1000, 2000),
          automation: fakeAutomation('auto-1', 'Nightly build'),
          projectId: 'proj-1',
        },
        {
          run: fakeRun('run-2', 5000, 6000),
          automation: fakeAutomation('auto-2', 'PR review'),
          projectId: 'proj-2',
        },
        {
          run: fakeRun('run-3', 3000, null),
          automation: fakeAutomation('auto-1', 'Nightly build'),
          projectId: 'proj-1',
        },
      ];

      items.sort((a, b) => {
        const timeA = a.run.startedAt ?? a.run.finishedAt ?? a.run.scheduledAt ?? 0;
        const timeB = b.run.startedAt ?? b.run.finishedAt ?? b.run.scheduledAt ?? 0;
        return timeB - timeA;
      });

      expect(items.map((i) => i.run.id)).toEqual(['run-2', 'run-3', 'run-1']);
    });
  });
});

function fakeAutomation(id: string, name: string): Automation {
  return {
    id,
    name,
    enabled: true,
    projectId: 'proj-1',
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
  };
}

function fakeRun(id: string, startedAt: number | null, finishedAt: number | null): AutomationRun {
  return {
    id,
    seq: 1,
    automationId: 'auto-1',
    status: 'done',
    triggerKind: 'manual',
    configSnapshot: {
      name: 'Task',
      schedule: { expr: '0 9 * * *', tz: 'UTC' },
      agent: { type: 'acp', start: { providerId: 'claude', initialQueue: [] } },
      workspace: null,
      task: { prompt: 'do it', runScripts: false },
    },
    generatedName: 'Run',
    scheduledAt: null,
    deadlineAt: null,
    startedAt,
    finishedAt,
    workspace: null,
    branchName: null,
    conversationId: null,
    sessionId: null,
    error: null,
  };
}
