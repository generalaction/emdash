import { describe, it, expect, beforeEach, vi } from 'vitest';
import os from 'os';
import fs from 'fs';
import path from 'path';

// Mock electron
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue(os.tmpdir()),
    getName: vi.fn().mockReturnValue('emdash-test'),
    getVersion: vi.fn().mockReturnValue('0.0.0-test'),
  },
  BrowserWindow: {
    getAllWindows: vi.fn().mockReturnValue([]),
  },
}));

// Mock logger
vi.mock('../../main/lib/logger', () => ({
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock ZenflowPlanService
vi.mock('../../main/services/ZenflowPlanService', () => ({
  zenflowPlanService: {
    readPlan: vi.fn().mockResolvedValue(null),
    writePlan: vi.fn().mockResolvedValue(undefined),
    updateStepStatus: vi.fn().mockResolvedValue(undefined),
    appendSteps: vi.fn().mockResolvedValue(undefined),
    startWatching: vi.fn(),
    stopWatching: vi.fn(),
    stopAll: vi.fn(),
  },
}));

// Mock DatabaseService
const mockSteps: any[] = [];
vi.mock('../../main/services/DatabaseService', () => ({
  databaseService: {
    getWorkflowSteps: vi.fn().mockImplementation(() => Promise.resolve([...mockSteps])),
    getWorkflowStep: vi
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve(mockSteps.find((s) => s.id === id) ?? null)
      ),
    saveWorkflowStep: vi.fn().mockResolvedValue(undefined),
    updateWorkflowStepStatus: vi
      .fn()
      .mockImplementation((id: string, status: string, extras?: any) => {
        const step = mockSteps.find((s) => s.id === id);
        if (step) {
          step.status = status;
          if (extras?.startedAt) step.startedAt = extras.startedAt;
          if (extras?.completedAt) step.completedAt = extras.completedAt;
          if (extras?.conversationId) step.conversationId = extras.conversationId;
        }
        return Promise.resolve();
      }),
    insertWorkflowSteps: vi.fn().mockImplementation((steps: any[]) => {
      mockSteps.push(...steps);
      return Promise.resolve();
    }),
    deleteWorkflowStepsAfter: vi.fn().mockResolvedValue(undefined),
    getTask: vi.fn().mockResolvedValue({
      id: 'task-1',
      path: '/tmp/test-worktree',
      metadata: JSON.stringify({
        zenflow: {
          enabled: true,
          template: 'spec-and-build',
          currentStepNumber: 1,
          totalSteps: 2,
          status: 'running',
          featureDescription: 'Test feature',
          artifactsDir: '.zenflow',
        },
      }),
    }),
    saveTask: vi.fn().mockResolvedValue({ success: true }),
    createConversation: vi.fn().mockImplementation((_taskId: string, title: string) => {
      const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      return Promise.resolve({ id, title, taskId: _taskId });
    }),
  },
}));

describe('ZenflowOrchestrationService', () => {
  let service: Awaited<
    typeof import('../../main/services/ZenflowOrchestrationService')
  >['zenflowOrchestrationService'];
  let tempDir: string;

  beforeEach(async () => {
    mockSteps.length = 0;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenflow-test-'));

    const mod = await import('../../main/services/ZenflowOrchestrationService');
    service = mod.zenflowOrchestrationService;

    // Clear event listeners between tests
    service.removeAllListeners();
  });

  describe('createWorkflow', () => {
    it('creates steps from spec-and-build template', async () => {
      const steps = await service.createWorkflow({
        taskId: 'task-1',
        template: 'spec-and-build',
        featureDescription: 'Add user authentication',
        worktreePath: tempDir,
      });

      expect(steps.length).toBe(2);
      expect(steps[0].name).toBe('Tech Spec');
      expect(steps[0].type).toBe('spec');
      expect(steps[0].stepNumber).toBe(1);
      expect(steps[0].pauseAfter).toBe(1);
      expect(steps[1].name).toBe('Implementation');
      expect(steps[1].type).toBe('implementation');
      expect(steps[1].stepNumber).toBe(2);
    });

    it('creates steps from full-sdd template', async () => {
      const steps = await service.createWorkflow({
        taskId: 'task-2',
        template: 'full-sdd',
        featureDescription: 'Build dashboard',
        worktreePath: tempDir,
      });

      expect(steps.length).toBe(3);
      expect(steps[0].name).toBe('Requirements');
      expect(steps[1].name).toBe('Tech Spec');
      expect(steps[2].name).toBe('Planning');
      expect(steps[2].pauseAfter).toBe(1);
    });

    it('creates .zenflow directory and writes plan.md via plan service', async () => {
      const { zenflowPlanService } = await import('../../main/services/ZenflowPlanService');
      vi.mocked(zenflowPlanService.writePlan).mockClear();

      await service.createWorkflow({
        taskId: 'task-3',
        template: 'spec-and-build',
        featureDescription: 'Test feature',
        worktreePath: tempDir,
      });

      const zenflowDir = path.join(tempDir, '.zenflow');
      expect(fs.existsSync(zenflowDir)).toBe(true);

      // plan.md is now written via zenflowPlanService, not directly
      expect(zenflowPlanService.writePlan).toHaveBeenCalledWith(
        tempDir,
        expect.objectContaining({
          featureDescription: 'Test feature',
          templateId: 'spec-and-build',
          steps: expect.arrayContaining([
            expect.objectContaining({ stepNumber: 1, name: 'Tech Spec' }),
          ]),
        })
      );
    });

    it('resolves prompt template placeholders', async () => {
      const steps = await service.createWorkflow({
        taskId: 'task-4',
        template: 'spec-and-build',
        featureDescription: 'My cool feature',
        worktreePath: tempDir,
      });

      expect(steps[0].prompt).toContain('My cool feature');
      expect(steps[0].prompt).toContain('.zenflow');
    });

    it('throws for unknown template', async () => {
      await expect(
        service.createWorkflow({
          taskId: 'task-5',
          template: 'nonexistent' as any,
          featureDescription: 'Test',
          worktreePath: tempDir,
        })
      ).rejects.toThrow('Unknown zenflow template');
    });
  });

  describe('handlePtyExit', () => {
    it('ignores non-zenflow PTY exits', async () => {
      // Should not throw or do anything
      await service.handlePtyExit('random-pty-id', 0);
    });

    it('marks step as completed on exit code 0', async () => {
      mockSteps.push({
        id: 'step-task-1-1',
        taskId: 'task-1',
        stepNumber: 1,
        name: 'Tech Spec',
        type: 'spec',
        status: 'running',
        pauseAfter: 1,
      });

      service.registerPtyStep('pty-123', 'task-1', 'step-task-1-1');
      await service.handlePtyExit('pty-123', 0);

      expect(mockSteps[0].status).toBe('completed');
    });

    it('emits workflow-paused when step has pauseAfter', async () => {
      mockSteps.push(
        {
          id: 'step-task-1-1',
          taskId: 'task-1',
          stepNumber: 1,
          name: 'Tech Spec',
          type: 'spec',
          status: 'running',
          pauseAfter: 1,
        },
        {
          id: 'step-task-1-2',
          taskId: 'task-1',
          stepNumber: 2,
          name: 'Implementation',
          type: 'implementation',
          status: 'pending',
          pauseAfter: 0,
        }
      );

      const events: any[] = [];
      service.onEvent((e) => events.push(e));

      service.registerPtyStep('pty-456', 'task-1', 'step-task-1-1');
      await service.handlePtyExit('pty-456', 0);

      expect(events.some((e) => e.type === 'workflow-paused')).toBe(true);
    });

    it('marks step as failed on non-zero exit', async () => {
      mockSteps.push({
        id: 'step-task-1-1',
        taskId: 'task-1',
        stepNumber: 1,
        name: 'Tech Spec',
        type: 'spec',
        status: 'running',
        pauseAfter: 0,
      });

      const events: any[] = [];
      service.onEvent((e) => events.push(e));

      service.registerPtyStep('pty-789', 'task-1', 'step-task-1-1');
      await service.handlePtyExit('pty-789', 1);

      expect(mockSteps[0].status).toBe('failed');
      expect(events.some((e) => e.type === 'step-failed')).toBe(true);
    });

    it('emits workflow-completed when last step finishes', async () => {
      mockSteps.push({
        id: 'step-task-1-1',
        taskId: 'task-1',
        stepNumber: 1,
        name: 'Only Step',
        type: 'implementation',
        status: 'running',
        pauseAfter: 0,
      });

      const events: any[] = [];
      service.onEvent((e) => events.push(e));

      service.registerPtyStep('pty-last', 'task-1', 'step-task-1-1');
      await service.handlePtyExit('pty-last', 0);

      expect(events.some((e) => e.type === 'workflow-completed')).toBe(true);
    });
  });

  describe('expandSteps', () => {
    it('adds new implementation steps after existing ones', async () => {
      mockSteps.push({
        id: 'step-task-1-1',
        taskId: 'task-1',
        stepNumber: 1,
        name: 'Planning',
        type: 'planning',
        status: 'completed',
        pauseAfter: 1,
      });

      const allSteps = await service.expandSteps('task-1', [
        { name: 'Build API', prompt: 'Build the API endpoints' },
        { name: 'Build UI', prompt: 'Build the UI components' },
      ]);

      expect(allSteps.length).toBe(3);
      expect(allSteps[1].name).toBe('Build API');
      expect(allSteps[1].stepNumber).toBe(2);
      expect(allSteps[2].name).toBe('Build UI');
      expect(allSteps[2].stepNumber).toBe(3);
    });
  });

  describe('registerPtyStep and cleanup', () => {
    it('clears PTY mapping after exit', async () => {
      mockSteps.push({
        id: 'step-task-1-1',
        taskId: 'task-1',
        stepNumber: 1,
        name: 'Step',
        type: 'implementation',
        status: 'running',
        pauseAfter: 0,
      });

      service.registerPtyStep('pty-cleanup', 'task-1', 'step-task-1-1');

      // First exit handles it
      await service.handlePtyExit('pty-cleanup', 0);

      // Second exit is a no-op (mapping cleared)
      const events: any[] = [];
      service.onEvent((e) => events.push(e));
      await service.handlePtyExit('pty-cleanup', 0);
      expect(events.length).toBe(0);
    });
  });
});
