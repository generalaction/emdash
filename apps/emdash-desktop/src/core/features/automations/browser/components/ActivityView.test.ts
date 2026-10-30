import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import type { AutomationRun } from '@core/features/automations/api/automation-run';
import type { Automation } from '@core/primitives/automations/api';
import { describe, expect, it } from 'vitest';
import {
  getActivityStatus,
  resolveActivityItemStatus,
  type ActivityItem,
} from './ActivityView';

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
      expect(getActivityStatus('done', null, { isSessionActive: true })).toBe('working');
    });

    it('does not treat unknown agent status on unadopted done runs as proof of completion', () => {
      // Unadopted done runs default to working since the executor marked done upon starting session
      expect(getActivityStatus('done', null)).toBe('working');
      expect(
        getActivityStatus('done', null, { hasTask: false, isSessionActive: undefined })
      ).toBe('working');
    });

    it('returns done when agent completed, task is adopted, or session closed', () => {
      expect(getActivityStatus('done', 'completed')).toBe('done');
      expect(getActivityStatus('done', 'idle')).toBe('done');
      expect(getActivityStatus('done', null, { hasTask: true })).toBe('done');
      expect(
        getActivityStatus('done', null, { hasTask: false, isSessionActive: false })
      ).toBe('done');
    });

    it('preserves queued, cancelled, and skipped statuses', () => {
      expect(getActivityStatus('queued', null)).toBe('queued');
      expect(getActivityStatus('cancelled', null)).toBe('cancelled');
      expect(getActivityStatus('skipped', null)).toBe('skipped');
    });
  });

  describe('resolveActivityItemStatus', () => {
    const unadoptedTaskLookup = () => ({ taskId: null, taskStore: undefined, agentStatus: null });

    it('reads live conversation status for unadopted runs', () => {
      const item: ActivityItem = {
        run: fakeRun('run-1', 1000, 2000, 'conv-1'),
        automation: fakeAutomation('auto-1', 'Nightly build'),
        projectId: 'proj-1',
      };
      const statuses = new Map([['conv-1', 'awaiting-input' as const]]);
      const activeSessions = new Set(['conv-1']);

      const resolved = resolveActivityItemStatus(
        item,
        statuses,
        activeSessions,
        true,
        unadoptedTaskLookup
      );
      expect(resolved.status).toBe('awaiting-input');
      expect(resolved.agentStatus).toBe('awaiting-input');
      expect(resolved.taskId).toBeNull();
    });

    it('detects active sessions for unadopted runs when agent status is not yet set', () => {
      const item: ActivityItem = {
        run: fakeRun('run-2', 1000, 2000, 'conv-2'),
        automation: fakeAutomation('auto-1', 'Nightly build'),
        projectId: 'proj-1',
      };
      const statuses = new Map();
      const activeSessions = new Set(['conv-2']);

      const resolved = resolveActivityItemStatus(
        item,
        statuses,
        activeSessions,
        true,
        unadoptedTaskLookup
      );
      expect(resolved.status).toBe('working');
      expect(resolved.agentStatus).toBeNull();
    });

    it('identifies unadopted runs whose sessions have closed as completed', () => {
      const item: ActivityItem = {
        run: fakeRun('run-3', 1000, 2000, 'conv-3'),
        automation: fakeAutomation('auto-1', 'Nightly build'),
        projectId: 'proj-1',
      };
      const statuses = new Map();
      const activeSessions = new Set<string>(); // session closed

      const resolved = resolveActivityItemStatus(
        item,
        statuses,
        activeSessions,
        true,
        unadoptedTaskLookup
      );
      expect(resolved.status).toBe('done');
    });

    it('uses adopted task agent status when available', () => {
      const item: ActivityItem = {
        run: fakeRun('run-4', 1000, 2000, 'conv-4'),
        automation: fakeAutomation('auto-1', 'Nightly build'),
        projectId: 'proj-1',
      };
      const statuses = new Map();
      const activeSessions = new Set<string>();
      const adoptedLookup = () => ({
        taskId: 'task-123',
        taskStore: undefined,
        agentStatus: 'working' as const,
      });

      const resolved = resolveActivityItemStatus(
        item,
        statuses,
        activeSessions,
        true,
        adoptedLookup
      );
      expect(resolved.status).toBe('working');
      expect(resolved.agentStatus).toBe('working');
      expect(resolved.taskId).toBe('task-123');
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

function fakeRun(
  id: string,
  startedAt: number | null,
  finishedAt: number | null,
  conversationId: string | null = null
): AutomationRun {
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
      workspace: {
        kind: 'worktree',
        repository: {
          host: LOCAL_HOST_REF,
          path: { root: { kind: 'posix' }, segments: ['repo'] },
        },
        worktreePoolPath: {
          root: { kind: 'posix' },
          segments: ['worktrees', 'repo-12345678'],
        },
        baseRemote: 'origin',
        preservePatterns: [],
        git: {
          kind: 'create-branch',
          fromBranch: { type: 'local', branch: 'main' },
          pushRemote: null,
        },
      },
    },
    generatedName: 'Run',
    scheduledAt: null,
    deadlineAt: null,
    startedAt,
    finishedAt,
    workspace: null,
    branchName: null,
    conversationId,
    sessionId: null,
    error: null,
  };
}
