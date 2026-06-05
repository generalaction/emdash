import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversation } from '@main/core/conversations/createConversation';
import { openProject } from '@main/core/projects/operations/openProject';
import { projectManager } from '@main/core/projects/project-manager';
import { appSettingsService } from '@main/core/settings/settings-service';
import { generateRandom } from '@main/core/tasks/name-generation/generateTaskName';
import {
  commitCreateTask,
  finalizeCreateTask,
  prepareCreateTask,
} from '@main/core/tasks/operations/createTask';
import { taskService } from '@main/core/tasks/task-service';
import type { Automation } from '@shared/automations/automation';
import type { AutomationRun } from '@shared/automations/automation-run';
import { updateRun } from '../repo';
import {
  markRunCreatingConversation,
  markRunFailed,
  markRunLaunchingTask,
} from '../run-transitions';
import { executeTaskCreate } from './taskCreate';

vi.mock('@main/core/conversations/createConversation', () => ({ createConversation: vi.fn() }));
vi.mock('@main/core/projects/operations/ensure-repository-workspace', () => ({
  ensureRepositoryWorkspace: vi.fn().mockResolvedValue('ws-repo-1'),
}));
vi.mock('@main/core/projects/operations/openProject', () => ({ openProject: vi.fn() }));
vi.mock('@main/db/client', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    }),
    transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(mockTx)),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ run: vi.fn() }) }) }),
  },
}));
vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: { getProject: vi.fn() },
}));
vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: { get: vi.fn() },
}));
vi.mock('@main/core/tasks/name-generation/generateTaskName', () => ({
  generateRandom: vi.fn(() => 'random-task-name'),
}));
vi.mock('@main/core/tasks/operations/createTask', () => ({
  prepareCreateTask: vi.fn(),
  commitCreateTask: vi.fn(),
  finalizeCreateTask: vi.fn(),
}));
vi.mock('@main/core/tasks/task-service', () => ({
  taskService: { notifyTaskCreated: vi.fn(), launch: vi.fn() },
}));
vi.mock('@main/lib/events', () => ({ events: { emit: vi.fn() } }));
vi.mock('@main/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../repo', () => ({ updateRun: vi.fn() }));
vi.mock('../run-transitions', () => ({
  markRunLaunchingTask: vi.fn(),
  markRunCreatingConversation: vi.fn(),
  markRunFailed: vi.fn(),
}));

const mockTx = {
  update: vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ run: vi.fn() }) }),
  }),
};

const automation: Automation = {
  id: 'automation-1',
  name: 'Daily follow-up',
  triggerConfig: { expr: '0 9 * * *', tz: 'UTC' },
  conversationConfig: { prompt: 'Check things', provider: 'claude', autoApprove: false },
  taskConfig: {
    version: '1' as const,
    taskConfig: {
      version: '1',
      name: 'Stored task',
    },
    workspaceConfig: {
      version: '2' as const,
      git: {
        kind: 'create-branch' as const,
        branchName: 'stored-task-branch',
        fromBranch: { type: 'local' as const, branch: 'main' },
        pushBranch: false,
      },
      workspace: { kind: 'new-worktree' as const },
    },
  },
  projectId: 'project-1',
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
};

const run: AutomationRun = {
  id: 'run-1',
  automationId: automation.id,
  scheduledAt: null,
  deadlineAt: null,
  startedAt: 1,
  taskCreatedAt: null,
  launchedAt: null,
  finishedAt: null,
  status: 'creating_task',
  taskId: null,
  error: null,
  triggerKind: 'manual',
  triggerConfigSnapshot: { expr: '0 9 * * *', tz: 'UTC' },
  conversationConfigSnapshot: { prompt: 'Check things', provider: 'claude', autoApprove: false },
  taskConfigSnapshot: null,
};

const mockTaskRow = { id: 'task-generated-uuid', name: 'random-task-name' } as never;
const mockConvRow = { id: 'conv-1' } as never;
const preparedData = {} as never;

describe('executeTaskCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generateRandom).mockReturnValue('random-task-name');
    vi.mocked(appSettingsService.get).mockResolvedValue(null as never);
    vi.mocked(projectManager.getProject).mockReturnValue({} as never);
    vi.mocked(prepareCreateTask).mockResolvedValue({ success: true, data: preparedData });
    vi.mocked(commitCreateTask).mockReturnValue({ taskRow: mockTaskRow, convRow: mockConvRow });
    vi.mocked(finalizeCreateTask).mockReturnValue({ task: { id: 'task-generated-uuid' } } as never);
    vi.mocked(taskService.launch).mockResolvedValue({
      success: true,
      data: { path: '/tmp/task', workspaceId: 'workspace-1' },
    });
    vi.mocked(createConversation).mockResolvedValue({} as never);
    vi.mocked(updateRun).mockImplementation(async (_, values) => ({ ...run, ...values }));
    vi.mocked(markRunLaunchingTask).mockResolvedValue({ ...run, status: 'launching_task' } as never);
    vi.mocked(markRunCreatingConversation).mockResolvedValue({ ...run, status: 'creating_conversation' } as never);
    vi.mocked(markRunFailed).mockResolvedValue({ ...run, status: 'failed' } as never);
  });

  it('returns err when the prompt is empty', async () => {
    const emptyPromptAutomation = {
      ...automation,
      conversationConfig: { prompt: '   ', provider: 'claude', autoApprove: false },
    };
    const result = await executeTaskCreate(emptyPromptAutomation, run);
    expect(result).toEqual({ success: false, error: 'task_create_prompt_empty' });
    expect(prepareCreateTask).not.toHaveBeenCalled();
  });

  it('returns err when automation has no projectId', async () => {
    const result = await executeTaskCreate({ ...automation, projectId: undefined }, run);
    expect(result).toEqual({ success: false, error: 'no_project_attached' });
    expect(prepareCreateTask).not.toHaveBeenCalled();
  });

  it('marks run failed and returns err when project cannot be opened', async () => {
    vi.mocked(projectManager.getProject).mockReturnValue(undefined);
    vi.mocked(openProject).mockResolvedValue({ success: false, error: 'not_found' as never });

    const result = await executeTaskCreate(automation, run);

    expect(result.success).toBe(false);
    expect(markRunFailed).toHaveBeenCalledWith(run.id, { step: 'create_task', code: 'project_not_found' });
    expect(prepareCreateTask).not.toHaveBeenCalled();
  });

  it('marks run failed when prepareCreateTask fails', async () => {
    vi.mocked(prepareCreateTask).mockResolvedValue({
      success: false,
      error: { type: 'branch-not-found', branch: 'my-branch' },
    });

    const result = await executeTaskCreate(automation, run);

    expect(result.success).toBe(false);
    expect(markRunFailed).toHaveBeenCalledWith(run.id, {
      step: 'create_task',
      code: 'branch_not_found',
      message: 'my-branch',
    });
    expect(commitCreateTask).not.toHaveBeenCalled();
  });

  it('calls markRunLaunchingTask after committing task to DB', async () => {
    const result = await executeTaskCreate(automation, run);

    expect(result.success).toBe(true);
    expect(commitCreateTask).toHaveBeenCalledWith(preparedData, mockTx);
    expect(markRunLaunchingTask).toHaveBeenCalledWith(run.id, expect.any(String), expect.any(Number));
    expect(taskService.launch).toHaveBeenCalled();
  });

  it('marks run failed when launch fails', async () => {
    vi.mocked(taskService.launch).mockResolvedValue({
      success: false,
      error: {
        type: 'setup-failed',
        stepKind: 'workspace-acquire',
        stepErrorType: 'error',
        message: 'provisioning failed',
      },
    });

    const result = await executeTaskCreate(automation, run);

    expect(result.success).toBe(false);
    expect(markRunFailed).toHaveBeenCalledWith(run.id, {
      step: 'launch_task',
      code: 'provision_failed',
      message: 'provisioning failed',
    });
    expect(createConversation).not.toHaveBeenCalled();
  });

  it('calls markRunCreatingConversation after successful launch', async () => {
    const result = await executeTaskCreate(automation, run);

    expect(result.success).toBe(true);
    expect(markRunCreatingConversation).toHaveBeenCalledWith(run.id, expect.any(Number));
    expect(createConversation).toHaveBeenCalled();
  });

  it('marks run failed when conversation creation throws', async () => {
    vi.mocked(createConversation).mockRejectedValue(new Error('conv_failed'));

    const result = await executeTaskCreate(automation, run);

    expect(result.success).toBe(false);
    expect(markRunFailed).toHaveBeenCalledWith(run.id, {
      step: 'create_conversation',
      code: 'failed',
      message: 'conv_failed',
    });
  });

  it('returns ok with taskId on full success', async () => {
    const result = await executeTaskCreate(automation, run);

    expect(result).toEqual({ success: true, data: { taskId: expect.any(String) } });
    expect(markRunFailed).not.toHaveBeenCalled();
  });

  it('uses generateRandom for the task name', async () => {
    await executeTaskCreate(automation, run);

    expect(generateRandom).toHaveBeenCalled();
    expect(prepareCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskConfig: expect.objectContaining({ name: 'random-task-name' }),
      })
    );
  });

  it('uses the random task name as the branch name in the workspace config', async () => {
    vi.mocked(generateRandom).mockReturnValue('jolly-tiger-runs-fast');

    await executeTaskCreate(automation, run);

    expect(prepareCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceConfig: expect.objectContaining({
          git: expect.objectContaining({ branchName: 'jolly-tiger-runs-fast' }),
        }),
      })
    );
  });

  it('enables auto-approval for Cursor conversations', async () => {
    await executeTaskCreate(
      {
        ...automation,
        conversationConfig: { prompt: 'Check things', provider: 'cursor', autoApprove: false },
      },
      run
    );

    expect(createConversation).toHaveBeenCalledWith(
      expect.objectContaining({ autoApprove: true, provider: 'cursor' })
    );
  });

  it('creates the conversation with config from automation, not run snapshot', async () => {
    await executeTaskCreate(automation, run);

    expect(createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'claude',
        initialPrompt: 'Check things',
        isInitialConversation: true,
      })
    );
  });

  it('opens the project when it is not loaded', async () => {
    vi.mocked(projectManager.getProject)
      .mockReturnValueOnce(undefined)
      .mockReturnValue({} as never);
    vi.mocked(openProject).mockResolvedValue({ success: true, data: undefined });

    const result = await executeTaskCreate(automation, run);

    expect(result.success).toBe(true);
    expect(openProject).toHaveBeenCalledWith('project-1');
  });
});
