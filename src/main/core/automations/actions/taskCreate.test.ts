import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversation } from '@main/core/conversations/createConversation';
import { openProject } from '@main/core/projects/operations/openProject';
import { projectManager } from '@main/core/projects/project-manager';
import { generateTaskName } from '@main/core/tasks/name-generation/generateTaskName';
import { taskService } from '@main/core/tasks/task-service';
import type { Automation, AutomationRun } from '@shared/automations/types';
import { updateRun } from '../repo';
import { executeTaskCreate } from './taskCreate';

vi.mock('@main/core/conversations/createConversation', () => ({ createConversation: vi.fn() }));
vi.mock('@main/core/projects/operations/openProject', () => ({ openProject: vi.fn() }));
vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: { getProject: vi.fn() },
}));
vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: { get: vi.fn() },
}));
vi.mock('@main/core/tasks/name-generation/generateTaskName', () => ({
  generateTaskName: vi.fn(() => 'generated-task'),
}));
vi.mock('@main/core/tasks/task-service', () => ({
  taskService: { createTask: vi.fn(), provision: vi.fn() },
}));
vi.mock('../repo', () => ({ updateRun: vi.fn() }));

const automation: Automation = {
  id: 'automation-1',
  name: 'Daily follow-up',
  description: null,
  category: 'custom',
  trigger: { expr: '0 9 * * *', tz: 'UTC' },
  actions: [{ kind: 'task.create', prompt: 'Check things' }],
  taskConfig: {
    id: 'stored-task-id',
    projectId: 'project-1',
    name: 'Stored task',
    sourceBranch: { type: 'local', branch: 'main' },
    strategy: { kind: 'no-worktree' },
    initialConversation: {
      id: 'stored-conversation-id',
      projectId: 'project-1',
      taskId: 'stored-task-id',
      provider: 'claude' as never,
      title: 'Stored task',
    },
  },
  projectId: 'project-1',
  enabled: true,
  isDraft: false,
  lastRunAt: null,
  nextRunAt: null,
  builtinTemplateId: null,
  deadlinePolicy: 'next-interval',
  deadlineMs: null,
  createdAt: 0,
  updatedAt: 0,
};

const run: AutomationRun = {
  id: 'run-1',
  automationId: automation.id,
  scheduledAt: null,
  deadlineAt: null,
  startedAt: 1,
  finishedAt: null,
  status: 'running',
  taskId: null,
  createdTaskId: null,
  error: null,
  triggerKind: 'manual',
  workerId: 'worker-1',
};

describe('executeTaskCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(taskService.provision).mockResolvedValue({
      success: true,
      data: { path: '/tmp/task', workspaceId: 'workspace-1' },
    });
    vi.mocked(createConversation).mockResolvedValue({} as never);
  });

  it('opens the project before creating a task from stored config', async () => {
    vi.mocked(projectManager.getProject)
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({} as never);
    vi.mocked(openProject).mockResolvedValueOnce({ success: true, data: undefined });
    vi.mocked(taskService.createTask).mockResolvedValueOnce({
      success: true,
      data: { task: {} as never },
    });

    const result = await executeTaskCreate(automation.actions[0]!, { automation, run });

    expect(result.success).toBe(true);
    expect(openProject).toHaveBeenCalledWith('project-1');
    expect(taskService.createTask).toHaveBeenCalledOnce();
  });

  it('leaves auto-approval to the saved task config or user defaults', async () => {
    vi.mocked(projectManager.getProject).mockReturnValue({} as never);
    vi.mocked(taskService.createTask).mockResolvedValueOnce({
      success: true,
      data: { task: {} as never },
    });

    await executeTaskCreate(automation.actions[0]!, { automation, run });

    const taskConfig = vi.mocked(taskService.createTask).mock.calls[0]?.[0];
    expect(taskConfig?.initialConversation?.autoApprove).toBeUndefined();
  });

  it('creates a task even when a previous action already created one for the run', async () => {
    vi.mocked(projectManager.getProject).mockReturnValue({} as never);
    vi.mocked(taskService.createTask).mockResolvedValueOnce({
      success: true,
      data: { task: {} as never },
    });

    await executeTaskCreate(automation.actions[0]!, {
      automation,
      run: { ...run, taskId: 'task-existing', createdTaskId: 'task-existing' },
    });

    expect(taskService.createTask).toHaveBeenCalledOnce();
  });

  it('persists the run task link immediately after task creation', async () => {
    vi.mocked(projectManager.getProject).mockReturnValue({} as never);
    vi.mocked(taskService.createTask).mockResolvedValueOnce({
      success: true,
      data: { task: {} as never },
    });

    const result = await executeTaskCreate(automation.actions[0]!, { automation, run });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(updateRun).toHaveBeenCalledWith(run.id, {
      taskId: result.data.taskId,
      createdTaskId: result.data.taskId,
    });
  });

  it('provisions the task and starts its initial conversation', async () => {
    vi.mocked(projectManager.getProject).mockReturnValue({} as never);
    vi.mocked(taskService.createTask).mockResolvedValueOnce({
      success: true,
      data: { task: {} as never },
    });

    const result = await executeTaskCreate(automation.actions[0]!, { automation, run });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(taskService.provision).toHaveBeenCalledWith(result.data.taskId);
    expect(createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        taskId: result.data.taskId,
        initialPrompt: 'Check things',
        isInitialConversation: true,
      })
    );
    expect(vi.mocked(taskService.provision).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(createConversation).mock.invocationCallOrder[0]
    );
  });

  it('returns the task id when provisioning fails after task creation', async () => {
    vi.mocked(projectManager.getProject).mockReturnValue({} as never);
    vi.mocked(taskService.createTask).mockResolvedValueOnce({
      success: true,
      data: { task: {} as never },
    });
    vi.mocked(taskService.provision).mockResolvedValueOnce({
      success: false,
      error: {
        type: 'timeout',
        message: 'provisioning timed out',
        timeout: 30_000,
        step: 'connecting',
      },
    });

    const result = await executeTaskCreate(automation.actions[0]!, { automation, run });

    expect(result).toEqual({
      success: false,
      error: {
        message: 'provisioning timed out (step: connecting)',
        taskId: expect.any(String),
      },
    });
    expect(createConversation).not.toHaveBeenCalled();
  });

  it('does not persist run/task mapping when task config construction throws after UUID generation', async () => {
    vi.mocked(generateTaskName).mockImplementationOnce(() => {
      throw new Error('after_uuid');
    });

    const result = await executeTaskCreate(automation.actions[0]!, {
      automation: { ...automation, taskConfig: null },
      run,
    });

    expect(result).toEqual({ success: false, error: { message: 'after_uuid' } });
    expect(taskService.createTask).not.toHaveBeenCalled();
    expect(taskService.provision).not.toHaveBeenCalled();
    expect(createConversation).not.toHaveBeenCalled();
  });
});
