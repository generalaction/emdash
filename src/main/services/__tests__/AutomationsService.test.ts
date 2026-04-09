import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be defined before importing the module under test
// ---------------------------------------------------------------------------

const mockGetPath = vi.fn().mockReturnValue('/tmp/test-automations');

vi.mock('electron', () => ({
  app: { getPath: (...args: unknown[]) => mockGetPath(...args) },
}));

vi.mock('../../lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Use real filesystem via a temp directory
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getDrizzleClient, resetDrizzleClient } from '../../db/drizzleClient';

// We need to dynamically import the module AFTER mocks are set up.
// The service file exports a singleton, so we import fresh for each test suite.
let tmpDir: string;

/**
 * Create the automations tables in the test database by executing the
 * migration SQL file directly. This mirrors what DatabaseService.ensureMigrations()
 * does in production, keeping the migration file as the single source of truth.
 */
async function createAutomationsTables(): Promise<void> {
  const drizzleDir = path.join(__dirname, '..', '..', '..', '..', 'drizzle');
  const { sqlite } = await getDrizzleClient();

  for (const file of ['0011_add_automations_tables.sql', '0012_add_automation_triggers.sql']) {
    const migrationSql = await fs.readFile(path.join(drizzleDir, file), 'utf-8');
    await new Promise<void>((resolve, reject) => {
      sqlite.exec(migrationSql, (err) => (err ? reject(err) : resolve()));
    });
  }
}

beforeEach(async () => {
  await resetDrizzleClient();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'automations-test-'));
  mockGetPath.mockReturnValue(tmpDir);
  // Reset singleton state so each test starts with a fresh initialization cycle
  automationsService?._resetForTesting();
  await createAutomationsTables();
});

afterEach(async () => {
  await resetDrizzleClient();
  vi.clearAllMocks();
  // Clean up temp files
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Import the service — since it's a singleton we need to work with the same
// instance but it reads from disk each time, so changing tmpDir is enough.
// ---------------------------------------------------------------------------
let automationsService: Awaited<typeof import('../AutomationsService')>['automationsService'];

beforeAll(async () => {
  const mod = await import('../AutomationsService');
  automationsService = mod.automationsService;
});

// ---------------------------------------------------------------------------
// computeNextRun — tested indirectly via create + schedule
// We can also test it by creating automations and checking nextRunAt
// ---------------------------------------------------------------------------

describe('AutomationsService', () => {
  describe('CRUD operations', () => {
    it('should create an automation and assign an ID', async () => {
      const automation = await automationsService.create({
        name: 'Test Automation',
        projectId: 'proj-1',
        projectName: 'My Project',
        prompt: 'Run tests',
        agentId: 'claude-code',
        schedule: { type: 'daily', hour: 9, minute: 0 },
      });

      expect(automation.id).toMatch(/^auto_/);
      expect(automation.name).toBe('Test Automation');
      expect(automation.projectId).toBe('proj-1');
      expect(automation.projectName).toBe('My Project');
      expect(automation.prompt).toBe('Run tests');
      expect(automation.agentId).toBe('claude-code');
      expect(automation.status).toBe('active');
      expect(automation.runCount).toBe(0);
      expect(automation.lastRunAt).toBeNull();
      expect(automation.lastRunResult).toBeNull();
      expect(automation.nextRunAt).toBeTruthy();
      expect(automation.useWorktree).toBe(true);
    });

    it('should default useWorktree to true', async () => {
      const automation = await automationsService.create({
        name: 'No Worktree',
        projectId: 'proj-1',
        prompt: 'test',
        agentId: 'claude-code',
        schedule: { type: 'daily', hour: 12, minute: 0 },
      });

      expect(automation.useWorktree).toBe(true);
    });

    it('should allow useWorktree = false', async () => {
      const automation = await automationsService.create({
        name: 'No Worktree',
        projectId: 'proj-1',
        prompt: 'test',
        agentId: 'claude-code',
        schedule: { type: 'daily', hour: 12, minute: 0 },
        useWorktree: false,
      });

      expect(automation.useWorktree).toBe(false);
    });

    it('should list all automations', async () => {
      await automationsService.create({
        name: 'First',
        projectId: 'p1',
        prompt: 'first',
        agentId: 'agent-1',
        schedule: { type: 'daily', hour: 8, minute: 0 },
      });
      await automationsService.create({
        name: 'Second',
        projectId: 'p2',
        prompt: 'second',
        agentId: 'agent-2',
        schedule: { type: 'weekly', hour: 10, minute: 30, dayOfWeek: 'mon' },
      });

      const list = await automationsService.list();
      expect(list).toHaveLength(2);
      expect(list[0].name).toBe('First');
      expect(list[1].name).toBe('Second');
    });

    it('should get an automation by ID', async () => {
      const created = await automationsService.create({
        name: 'Get Test',
        projectId: 'p1',
        prompt: 'get me',
        agentId: 'agent-1',
        schedule: { type: 'hourly', minute: 15 },
      });

      const fetched = await automationsService.get(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.name).toBe('Get Test');
    });

    it('should return null for non-existent ID', async () => {
      const result = await automationsService.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should update an automation', async () => {
      const created = await automationsService.create({
        name: 'Original',
        projectId: 'p1',
        prompt: 'original prompt',
        agentId: 'agent-1',
        schedule: { type: 'daily', hour: 9, minute: 0 },
      });

      const updated = await automationsService.update({
        id: created.id,
        name: 'Updated Name',
        prompt: 'updated prompt',
      });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated Name');
      expect(updated!.prompt).toBe('updated prompt');
      expect(updated!.agentId).toBe('agent-1'); // unchanged
    });

    it('should recalculate nextRunAt when schedule is updated', async () => {
      const created = await automationsService.create({
        name: 'Schedule Update',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'daily', hour: 9, minute: 0 },
      });

      const originalNext = created.nextRunAt;

      const updated = await automationsService.update({
        id: created.id,
        schedule: { type: 'weekly', hour: 14, minute: 30, dayOfWeek: 'fri' },
      });

      expect(updated!.nextRunAt).not.toBe(originalNext);
      expect(updated!.schedule.type).toBe('weekly');
    });

    it('should return null when updating non-existent ID', async () => {
      const result = await automationsService.update({
        id: 'nonexistent',
        name: 'nope',
      });
      expect(result).toBeNull();
    });

    it('should delete an automation', async () => {
      const created = await automationsService.create({
        name: 'To Delete',
        projectId: 'p1',
        prompt: 'delete me',
        agentId: 'agent-1',
        schedule: { type: 'daily', hour: 9, minute: 0 },
      });

      const deleted = await automationsService.delete(created.id);
      expect(deleted).toBe(true);

      const fetched = await automationsService.get(created.id);
      expect(fetched).toBeNull();
    });

    it('should return false when deleting non-existent ID', async () => {
      const result = await automationsService.delete('nonexistent');
      expect(result).toBe(false);
    });

    it('should toggle status active → paused → active', async () => {
      const created = await automationsService.create({
        name: 'Toggle Test',
        projectId: 'p1',
        prompt: 'toggle me',
        agentId: 'agent-1',
        schedule: { type: 'daily', hour: 9, minute: 0 },
      });

      expect(created.status).toBe('active');

      const paused = await automationsService.toggleStatus(created.id);
      expect(paused!.status).toBe('paused');

      const reactivated = await automationsService.toggleStatus(created.id);
      expect(reactivated!.status).toBe('active');
      expect(reactivated!.nextRunAt).toBeTruthy();
    });

    it('should clear error state when re-activating', async () => {
      const created = await automationsService.create({
        name: 'Error Test',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'daily', hour: 9, minute: 0 },
      });

      // Set an error state
      await automationsService.setLastRunResult(created.id, 'failure', 'Something broke');

      // Pause then reactivate
      await automationsService.toggleStatus(created.id);
      const reactivated = await automationsService.toggleStatus(created.id);

      expect(reactivated!.lastRunError).toBeNull();
    });
  });

  describe('validateSchedule', () => {
    it('should reject invalid schedule types', async () => {
      await expect(
        automationsService.create({
          name: 'Bad Schedule',
          projectId: 'p1',
          prompt: 'test',
          agentId: 'agent-1',
          schedule: { type: 'biweekly' as never },
        })
      ).rejects.toThrow('Invalid schedule type');
    });

    it('should reject invalid hour values', async () => {
      await expect(
        automationsService.create({
          name: 'Bad Hour',
          projectId: 'p1',
          prompt: 'test',
          agentId: 'agent-1',
          schedule: { type: 'daily', hour: 25, minute: 0 },
        })
      ).rejects.toThrow('Invalid hour');
    });

    it('should reject negative hour values', async () => {
      await expect(
        automationsService.create({
          name: 'Negative Hour',
          projectId: 'p1',
          prompt: 'test',
          agentId: 'agent-1',
          schedule: { type: 'daily', hour: -1, minute: 0 },
        })
      ).rejects.toThrow('Invalid hour');
    });

    it('should reject invalid minute values', async () => {
      await expect(
        automationsService.create({
          name: 'Bad Minute',
          projectId: 'p1',
          prompt: 'test',
          agentId: 'agent-1',
          schedule: { type: 'daily', hour: 12, minute: 60 },
        })
      ).rejects.toThrow('Invalid minute');
    });

    it('should reject invalid dayOfWeek', async () => {
      await expect(
        automationsService.create({
          name: 'Bad Day',
          projectId: 'p1',
          prompt: 'test',
          agentId: 'agent-1',
          schedule: { type: 'weekly', hour: 9, minute: 0, dayOfWeek: 'xyz' as never },
        })
      ).rejects.toThrow('Invalid dayOfWeek');
    });

    it('should reject invalid dayOfMonth', async () => {
      await expect(
        automationsService.create({
          name: 'Bad DOM',
          projectId: 'p1',
          prompt: 'test',
          agentId: 'agent-1',
          schedule: { type: 'monthly', hour: 9, minute: 0, dayOfMonth: 32 },
        })
      ).rejects.toThrow('Invalid dayOfMonth');
    });

    it('should reject dayOfMonth of 0', async () => {
      await expect(
        automationsService.create({
          name: 'Zero DOM',
          projectId: 'p1',
          prompt: 'test',
          agentId: 'agent-1',
          schedule: { type: 'monthly', hour: 9, minute: 0, dayOfMonth: 0 },
        })
      ).rejects.toThrow('Invalid dayOfMonth');
    });

    it('should accept valid schedules at boundary values', async () => {
      // Hour 0, Minute 0
      const a = await automationsService.create({
        name: 'Midnight',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'daily', hour: 0, minute: 0 },
      });
      expect(a.schedule.hour).toBe(0);

      // Hour 23, Minute 59
      const b = await automationsService.create({
        name: 'Late Night',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'daily', hour: 23, minute: 59 },
      });
      expect(b.schedule.hour).toBe(23);
      expect(b.schedule.minute).toBe(59);

      // Day of month 31
      const c = await automationsService.create({
        name: 'End of Month',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'monthly', hour: 9, minute: 0, dayOfMonth: 31 },
      });
      expect(c.schedule.dayOfMonth).toBe(31);
    });
  });

  describe('computeNextRun (via create)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should compute next hourly run', async () => {
      // Set time to 14:20:00
      vi.setSystemTime(new Date(2025, 5, 15, 14, 20, 0));

      const automation = await automationsService.create({
        name: 'Hourly',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'hourly', minute: 30 },
      });

      const next = new Date(automation.nextRunAt!);
      // Next :30 after 14:20 is 14:30
      expect(next.getHours()).toBe(14);
      expect(next.getMinutes()).toBe(30);
    });

    it('should advance to next hour when minute has passed', async () => {
      // Set time to 14:45:00
      vi.setSystemTime(new Date(2025, 5, 15, 14, 45, 0));

      const automation = await automationsService.create({
        name: 'Hourly Past',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'hourly', minute: 30 },
      });

      const next = new Date(automation.nextRunAt!);
      // Next :30 after 14:45 is 15:30
      expect(next.getHours()).toBe(15);
      expect(next.getMinutes()).toBe(30);
    });

    it('should compute next daily run', async () => {
      // Set time to 2025-06-15 10:00:00
      vi.setSystemTime(new Date(2025, 5, 15, 10, 0, 0));

      const automation = await automationsService.create({
        name: 'Daily',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'daily', hour: 14, minute: 0 },
      });

      const next = new Date(automation.nextRunAt!);
      // Same day, 14:00
      expect(next.getDate()).toBe(15);
      expect(next.getHours()).toBe(14);
    });

    it('should advance daily to next day when time has passed', async () => {
      // Set time to 2025-06-15 16:00:00
      vi.setSystemTime(new Date(2025, 5, 15, 16, 0, 0));

      const automation = await automationsService.create({
        name: 'Daily Tomorrow',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'daily', hour: 14, minute: 0 },
      });

      const next = new Date(automation.nextRunAt!);
      // Next day, 14:00
      expect(next.getDate()).toBe(16);
      expect(next.getHours()).toBe(14);
    });

    it('should compute next weekly run', async () => {
      // 2025-06-15 is a Sunday
      vi.setSystemTime(new Date(2025, 5, 15, 10, 0, 0));

      const automation = await automationsService.create({
        name: 'Weekly',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'weekly', hour: 9, minute: 0, dayOfWeek: 'wed' },
      });

      const next = new Date(automation.nextRunAt!);
      // Next Wednesday after Sunday June 15 = June 18
      expect(next.getDate()).toBe(18);
      expect(next.getDay()).toBe(3); // Wednesday
      expect(next.getHours()).toBe(9);
    });

    it('should advance weekly to next week when day+time has passed', async () => {
      // 2025-06-18 is a Wednesday, set time after 9:00
      vi.setSystemTime(new Date(2025, 5, 18, 12, 0, 0));

      const automation = await automationsService.create({
        name: 'Weekly Next',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'weekly', hour: 9, minute: 0, dayOfWeek: 'wed' },
      });

      const next = new Date(automation.nextRunAt!);
      // Next Wednesday = June 25
      expect(next.getDate()).toBe(25);
      expect(next.getDay()).toBe(3);
    });

    it('should compute next monthly run', async () => {
      // June 5, before the 15th
      vi.setSystemTime(new Date(2025, 5, 5, 10, 0, 0));

      const automation = await automationsService.create({
        name: 'Monthly',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'monthly', hour: 9, minute: 0, dayOfMonth: 15 },
      });

      const next = new Date(automation.nextRunAt!);
      // Same month, June 15
      expect(next.getMonth()).toBe(5);
      expect(next.getDate()).toBe(15);
    });

    it('should advance monthly to next month when day has passed', async () => {
      // June 20, after the 15th
      vi.setSystemTime(new Date(2025, 5, 20, 10, 0, 0));

      const automation = await automationsService.create({
        name: 'Monthly Next',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'monthly', hour: 9, minute: 0, dayOfMonth: 15 },
      });

      const next = new Date(automation.nextRunAt!);
      // Next month, July 15
      expect(next.getMonth()).toBe(6);
      expect(next.getDate()).toBe(15);
    });

    it('should clamp dayOfMonth to last day of month (Feb 30 → Feb 28)', async () => {
      // Set to Feb 1 — schedule for day 30 but Feb only has 28 days
      vi.setSystemTime(new Date(2025, 1, 1, 10, 0, 0));

      const automation = await automationsService.create({
        name: 'Month Clamp',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'monthly', hour: 9, minute: 0, dayOfMonth: 30 },
      });

      const next = new Date(automation.nextRunAt!);
      // February 2025 has 28 days, so clamped to 28
      expect(next.getMonth()).toBe(1); // February
      expect(next.getDate()).toBeLessThanOrEqual(28);
    });
  });

  describe('run logs', () => {
    it('should create and retrieve run logs via manual trigger', async () => {
      const automation = await automationsService.create({
        name: 'Run Log Test',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'daily', hour: 9, minute: 0 },
      });

      const runLogId = await automationsService.createManualRunLog(automation.id);
      expect(runLogId).toMatch(/^auto_/);

      const logs = await automationsService.getRunLogs(automation.id);
      expect(logs).toHaveLength(1);
      expect(logs[0].status).toBe('running');
      expect(logs[0].automationId).toBe(automation.id);
    });

    it('should update run log status', async () => {
      const automation = await automationsService.create({
        name: 'Update Log',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'daily', hour: 9, minute: 0 },
      });

      const runLogId = await automationsService.createManualRunLog(automation.id);
      await automationsService.updateRunLog(runLogId, {
        status: 'success',
        finishedAt: new Date().toISOString(),
        taskId: 'task-123',
      });

      const logs = await automationsService.getRunLogs(automation.id);
      expect(logs[0].status).toBe('success');
      expect(logs[0].taskId).toBe('task-123');
      expect(logs[0].finishedAt).toBeTruthy();
    });

    it('should increment runCount on manual trigger', async () => {
      const automation = await automationsService.create({
        name: 'Count Test',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'daily', hour: 9, minute: 0 },
      });

      await automationsService.createManualRunLog(automation.id);
      await automationsService.createManualRunLog(automation.id);

      const fetched = await automationsService.get(automation.id);
      expect(fetched!.runCount).toBe(2);
    });

    it('should set last run result', async () => {
      const automation = await automationsService.create({
        name: 'Result Test',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'daily', hour: 9, minute: 0 },
      });

      await automationsService.setLastRunResult(automation.id, 'failure', 'Timeout');

      const fetched = await automationsService.get(automation.id);
      expect(fetched!.lastRunResult).toBe('failure');
      expect(fetched!.lastRunError).toBe('Timeout');
    });

    it('should clean up run logs when automation is deleted', async () => {
      const automation = await automationsService.create({
        name: 'Cleanup Test',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'daily', hour: 9, minute: 0 },
      });

      await automationsService.createManualRunLog(automation.id);
      await automationsService.createManualRunLog(automation.id);

      await automationsService.delete(automation.id);

      const logs = await automationsService.getRunLogs(automation.id);
      expect(logs).toHaveLength(0);
    });

    it('should limit run logs when queried', async () => {
      const automation = await automationsService.create({
        name: 'Limit Test',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'daily', hour: 9, minute: 0 },
      });

      // Create 5 run logs
      for (let i = 0; i < 5; i++) {
        await automationsService.createManualRunLog(automation.id);
      }

      const limited = await automationsService.getRunLogs(automation.id, 3);
      expect(limited).toHaveLength(3);
    });
  });

  describe('reconcileMissedRuns', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should trigger a catch-up run and recalculate nextRunAt for missed schedules', async () => {
      const triggerCb = vi.fn();
      automationsService.onTrigger(triggerCb);

      // Create an automation at 10:00
      vi.setSystemTime(new Date(2025, 5, 15, 10, 0, 0));
      const automation = await automationsService.create({
        name: 'Missed',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'daily', hour: 14, minute: 0 },
      });

      // Jump forward 3 days — the nextRunAt is now in the past
      vi.setSystemTime(new Date(2025, 5, 18, 16, 0, 0));

      await automationsService.reconcileMissedRuns();

      // nextRunAt should advance to the next future occurrence
      const fetched = await automationsService.get(automation.id);
      const nextRun = new Date(fetched!.nextRunAt!);
      expect(nextRun.getDate()).toBe(19);
      expect(nextRun.getHours()).toBe(14);

      // Should have triggered the catch-up callback exactly once
      expect(triggerCb).toHaveBeenCalledTimes(1);
      expect(triggerCb).toHaveBeenCalledWith(
        expect.objectContaining({ id: automation.id, name: 'Missed' }),
        expect.stringMatching(/^auto_/)
      );

      // Should have created a run log for the catch-up
      const logs = await automationsService.getRunLogs(automation.id);
      expect(logs).toHaveLength(1);
      expect(logs[0].status).toBe('running');
      expect(
        (automationsService as unknown as { inFlightRuns: Set<string> }).inFlightRuns.has(
          automation.id
        )
      ).toBe(true);

      // runCount should be incremented
      expect(fetched!.runCount).toBe(1);
      expect(fetched!.lastRunAt).toBeTruthy();
    });

    it('should trigger exactly once even when multiple schedule occurrences were missed', async () => {
      const triggerCb = vi.fn();
      automationsService.onTrigger(triggerCb);

      // Create an hourly automation
      vi.setSystemTime(new Date(2025, 5, 15, 10, 0, 0));
      await automationsService.create({
        name: 'Hourly Missed',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'hourly', minute: 0 },
      });

      // Jump forward 48 hours — many occurrences missed
      vi.setSystemTime(new Date(2025, 5, 17, 10, 0, 0));

      await automationsService.reconcileMissedRuns();

      // Should only trigger once, not 48 times
      expect(triggerCb).toHaveBeenCalledTimes(1);
    });

    it('should not trigger catch-up for paused automations', async () => {
      const triggerCb = vi.fn();
      automationsService.onTrigger(triggerCb);

      vi.setSystemTime(new Date(2025, 5, 15, 10, 0, 0));
      const automation = await automationsService.create({
        name: 'Paused',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'daily', hour: 14, minute: 0 },
      });

      // Pause the automation
      await automationsService.toggleStatus(automation.id);

      // Jump forward
      vi.setSystemTime(new Date(2025, 5, 18, 16, 0, 0));

      await automationsService.reconcileMissedRuns();

      // No trigger for paused automations
      expect(triggerCb).not.toHaveBeenCalled();
    });

    it('should mark orphaned "running" run logs as interrupted', async () => {
      vi.setSystemTime(new Date(2025, 5, 15, 10, 0, 0));
      const automation = await automationsService.create({
        name: 'Orphan Test',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'daily', hour: 14, minute: 0 },
      });

      // Simulate a run that started and was never completed (app crashed)
      await automationsService.createManualRunLog(automation.id);

      // Jump forward 30 minutes (within max duration, but app "restarted")
      vi.setSystemTime(new Date(2025, 5, 15, 10, 30, 0));
      await automationsService.reconcileMissedRuns();

      const logs = await automationsService.getRunLogs(automation.id);
      // The orphaned run should be marked as failed
      const failedLog = logs.find((l) => l.error === 'Interrupted (app was closed or crashed)');
      expect(failedLog).toBeTruthy();
      expect(failedLog!.status).toBe('failure');
      expect(failedLog!.finishedAt).toBeTruthy();

      // Automation itself should also reflect the failure
      const fetched = await automationsService.get(automation.id);
      expect(fetched!.lastRunResult).toBe('failure');
      expect(fetched!.lastRunError).toBe('Interrupted (app was closed or crashed)');
    });

    it('should clear in-flight state when startup reconciliation fails an orphaned run', async () => {
      vi.setSystemTime(new Date(2025, 5, 15, 10, 0, 0));
      const automation = await automationsService.create({
        name: 'In Flight Cleanup',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'daily', hour: 14, minute: 0 },
      });

      await automationsService.createManualRunLog(automation.id);

      const inFlightRuns = (automationsService as unknown as { inFlightRuns: Set<string> })
        .inFlightRuns;
      inFlightRuns.add(automation.id);

      vi.setSystemTime(new Date(2025, 5, 15, 10, 30, 0));
      await automationsService.reconcileMissedRuns();

      expect(inFlightRuns.has(automation.id)).toBe(false);
    });

    it('should mark runs exceeding max duration as timed out', async () => {
      vi.setSystemTime(new Date(2025, 5, 15, 10, 0, 0));
      const automation = await automationsService.create({
        name: 'Timeout Test',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'daily', hour: 14, minute: 0 },
      });

      await automationsService.createManualRunLog(automation.id);

      // Jump forward 3 hours (exceeds 2h max duration)
      vi.setSystemTime(new Date(2025, 5, 15, 13, 0, 0));
      await automationsService.reconcileMissedRuns();

      const logs = await automationsService.getRunLogs(automation.id);
      const timedOutLog = logs.find((l) => l.error?.includes('timed out'));
      expect(timedOutLog).toBeTruthy();
      expect(timedOutLog!.status).toBe('failure');
      expect(timedOutLog!.error).toMatch(/Run timed out after \d+ minutes/);
    });

    it('should not touch completed run logs during reconcile', async () => {
      vi.setSystemTime(new Date(2025, 5, 15, 10, 0, 0));
      const automation = await automationsService.create({
        name: 'Completed Test',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'daily', hour: 14, minute: 0 },
      });

      const runLogId = await automationsService.createManualRunLog(automation.id);
      await automationsService.updateRunLog(runLogId, {
        status: 'success',
        finishedAt: new Date().toISOString(),
      });

      vi.setSystemTime(new Date(2025, 5, 15, 10, 30, 0));
      await automationsService.reconcileMissedRuns();

      const logs = await automationsService.getRunLogs(automation.id);
      const successLog = logs.find((l) => l.id === runLogId);
      expect(successLog!.status).toBe('success'); // Untouched
    });

    it('should preserve live in-flight runs when catching up after resume', async () => {
      const triggerCb = vi.fn();
      automationsService.onTrigger(triggerCb);

      vi.setSystemTime(new Date(2025, 5, 15, 10, 0, 0));
      const automation = await automationsService.create({
        name: 'Resume Cleanup Guard',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'daily', hour: 10, minute: 15 },
      });

      const originalNextRunAt = automation.nextRunAt;
      const runLogId = await automationsService.createManualRunLog(automation.id);

      const inFlightRuns = (automationsService as unknown as { inFlightRuns: Set<string> })
        .inFlightRuns;
      inFlightRuns.add(automation.id);

      vi.setSystemTime(new Date(2025, 5, 15, 10, 30, 0));
      await automationsService.reconcileMissedRunsAfterResume();

      const logs = await automationsService.getRunLogs(automation.id);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        id: runLogId,
        status: 'running',
        finishedAt: null,
        error: null,
      });

      const fetched = await automationsService.get(automation.id);
      expect(fetched!.lastRunResult).toBeNull();
      expect(fetched!.lastRunError).toBeNull();
      expect(fetched!.nextRunAt).toBe(originalNextRunAt);
      expect(triggerCb).not.toHaveBeenCalled();
    });

    it('should catch-up AND clean up orphaned runs for the same automation', async () => {
      const triggerCb = vi.fn();
      automationsService.onTrigger(triggerCb);

      // Create an hourly automation at 10:00 — nextRunAt will be 10:30
      vi.setSystemTime(new Date(2025, 5, 15, 10, 0, 0));
      const automation = await automationsService.create({
        name: 'Both Test',
        projectId: 'p1',
        prompt: 'test',
        agentId: 'agent-1',
        schedule: { type: 'hourly', minute: 30 },
      });

      // Simulate a run that was in progress when app closed
      await automationsService.createManualRunLog(automation.id);

      // Jump forward 1 hour — orphaned run is within 2h window (→ "Interrupted"),
      // and nextRunAt (10:30) is in the past (→ catch-up triggered)
      vi.setSystemTime(new Date(2025, 5, 15, 11, 0, 0));

      await automationsService.reconcileMissedRuns();

      // Orphaned run should be marked as interrupted
      const logs = await automationsService.getRunLogs(automation.id);
      const failedLog = logs.find((l) => l.error?.includes('Interrupted'));
      expect(failedLog).toBeTruthy();
      expect(failedLog!.status).toBe('failure');

      // Catch-up run should be triggered
      expect(triggerCb).toHaveBeenCalledTimes(1);

      // A new "running" log should exist for the catch-up
      const runningLog = logs.find((l) => l.status === 'running');
      expect(runningLog).toBeTruthy();
    });
  });

  describe('legacy JSON compatibility', () => {
    it('ignores legacy JSON files completely', async () => {
      const now = new Date().toISOString();

      await fs.writeFile(path.join(tmpDir, 'automations.json'), '{ broken json', 'utf-8');
      await fs.writeFile(
        path.join(tmpDir, 'automation-runs.json'),
        JSON.stringify(
          {
            runs: [
              {
                id: 'auto_run_legacy_1',
                automationId: 'auto_legacy_1',
                startedAt: now,
                finishedAt: now,
                status: 'success',
                error: null,
                taskId: 'task-legacy',
              },
            ],
          },
          null,
          2
        ),
        'utf-8'
      );

      const list = await automationsService.list();
      expect(list).toEqual([]);
    });
  });

  describe('scheduler', () => {
    it('should start and stop without errors', async () => {
      // Starting the scheduler should not throw
      automationsService.start();
      // Starting again should be a no-op (idempotent)
      automationsService.start();
      // Allow the immediate startup tick to complete
      await new Promise((resolve) => setTimeout(resolve, 25));
      // Stopping should work
      automationsService.stop();
      // Stopping again should be safe
      automationsService.stop();
      // Ensure no cached sqlite handle is left open for tmpDir cleanup
      await resetDrizzleClient();
    });

    it('should register trigger callbacks', () => {
      const cb = vi.fn();
      // onTrigger should accept a callback without throwing
      automationsService.onTrigger(cb);
    });
  });
});
