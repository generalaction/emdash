import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Automation, AutomationRun } from '@shared/automations/types';
import { generateTaskName } from '@main/core/tasks/name-generation/generateTaskName';
import { createTask } from '@main/core/tasks/operations/createTask';
import { executeTaskCreate } from './taskCreate';

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
vi.mock('@main/core/tasks/operations/createTask', () => ({ createTask: vi.fn() }));
const dbMock = vi.hoisted(() => {
  const run = vi.fn();
  const where = vi.fn(() => ({ run }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  return { run, where, set, update };
});
vi.mock('@main/db/client', () => ({
  db: { update: dbMock.update },
}));

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
  });

  it('creates a task even when a previous action already created one for the run', async () => {
    vi.mocked(createTask).mockResolvedValueOnce({ success: true, data: { task: {} as never } });

    await executeTaskCreate(automation.actions[0]!, {
      automation,
      run: { ...run, taskId: 'task-existing', createdTaskId: 'task-existing' },
    });

    expect(createTask).toHaveBeenCalledOnce();
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
    expect(createTask).not.toHaveBeenCalled();
  });
});
