import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversation } from '@main/core/conversations/createConversation';
import { openProject } from '@main/core/projects/operations/openProject';
import { projectManager } from '@main/core/projects/project-manager';
import { appSettingsService } from '@main/core/settings/settings-service';
import { generateTaskName } from '@main/core/tasks/name-generation/generateTaskName';
import { taskService } from '@main/core/tasks/task-service';
import type { Automation, AutomationRun } from '@shared/automations/types';
import { updateRun } from '../repo';
import { executeTaskCreate } from './taskCreate';

vi.mock('@main/core/conversations/createConversation', () => ({ createConversation: vi.fn() }));
vi.mock('@main/core/projects/operations/ensure-repository-workspace', () => ({
  ensureRepositoryWorkspace: vi.fn().mockResolvedValue('ws-repo-1'),
}));
vi.mock('@main/core/projects/operations/openProject', () => ({ openProject: vi.fn() }));
vi.mock('@main/db/client', () => ({ db: { select: vi.fn(), insert: vi.fn(), update: vi.fn() } }));
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
  taskService: { createTask: vi.fn(), launch: vi.fn() },
}));
vi.mock('@main/core/workspaces/workspace-bootstrap-service', () => ({
  workspaceBootstrapService: { ensureWorkspaceSetupForTask: vi.fn() },
}));
vi.mock('@main/lib/events', () => ({ events: { emit: vi.fn() } }));
vi.mock('@main/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../automation-events', () => ({ automationEvents: { _emit: vi.fn() } }));
vi.mock('../repo', () => ({ updateRun: vi.fn() }));

const automation: Automation = {
  id: 'automation-1',
  name: 'Daily follow-up',
  description: null,
  category: 'custom',
  trigger: { expr: '0 9 * * *', tz: 'UTC' },
  actions: [{ kind: 'task.create', prompt: 'Check things' }],
  taskConfig: {
    taskConfig: {
      version: '1',
      name: 'Stored task',
      initialConversation: {
        id: 'stored-conversation-id',
        projectId: 'project-1',
        taskId: 'stored-task-id',
        provider: 'claude' as never,
        title: 'Stored task',
      },
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
  isDraft: false,
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
    vi.mocked(generateTaskName).mockReturnValue('generated-task');
    vi.mocked(appSettingsService.get).mockResolvedValue(null as never);
    vi.mocked(taskService.launch).mockResolvedValue({
      success: true,
      data: { path: '/tmp/task', workspaceId: 'workspace-1' },
    });
    vi.mocked(createConversation).mockResolvedValue({} as never);
    vi.mocked(updateRun).mockImplementation(async (_, values) => ({ ...run, ...values }));
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

  it('enables auto-approval for automation-created Cursor conversations', async () => {
    vi.mocked(projectManager.getProject).mockReturnValue({} as never);
    vi.mocked(taskService.createTask).mockResolvedValueOnce({
      success: true,
      data: { task: {} as never },
    });

    await executeTaskCreate(automation.actions[0]!, {
      automation: {
        ...automation,
        taskConfig: {
          ...automation.taskConfig!,
          taskConfig: {
            ...automation.taskConfig!.taskConfig,
            initialConversation: {
              ...automation.taskConfig!.taskConfig.initialConversation!,
              provider: 'cursor',
              autoApprove: false,
            },
          },
        },
      },
      run,
    });

    const createArg = vi.mocked(taskService.createTask).mock.calls[0]?.[0];
    expect(createArg?.taskConfig.initialConversation?.autoApprove).toBe(true);
  });

  it.each(['claude', 'codex'] as const)(
    'enables auto-approval for automation-created %s conversations when the provider supports it',
    async (provider) => {
      vi.mocked(projectManager.getProject).mockReturnValue({} as never);
      vi.mocked(taskService.createTask).mockResolvedValueOnce({
        success: true,
        data: { task: {} as never },
      });

      await executeTaskCreate(automation.actions[0]!, {
        automation: {
          ...automation,
          taskConfig: {
            ...automation.taskConfig!,
            taskConfig: {
              ...automation.taskConfig!.taskConfig,
              initialConversation: {
                ...automation.taskConfig!.taskConfig.initialConversation!,
                provider,
                autoApprove: false,
              },
            },
          },
        },
        run,
      });

      const createArg = vi.mocked(taskService.createTask).mock.calls[0]?.[0];
      expect(createArg?.taskConfig.initialConversation?.autoApprove).toBe(true);
    }
  );

  it('enables auto-approval for automation-created OpenCode conversations via provider env', async () => {
    vi.mocked(projectManager.getProject).mockReturnValue({} as never);
    vi.mocked(taskService.createTask).mockResolvedValueOnce({
      success: true,
      data: { task: {} as never },
    });

    await executeTaskCreate(automation.actions[0]!, {
      automation: {
        ...automation,
        taskConfig: {
          ...automation.taskConfig!,
          taskConfig: {
            ...automation.taskConfig!.taskConfig,
            initialConversation: {
              ...automation.taskConfig!.taskConfig.initialConversation!,
              provider: 'opencode',
              autoApprove: false,
            },
          },
        },
      },
      run,
    });

    const createArg = vi.mocked(taskService.createTask).mock.calls[0]?.[0];
    expect(createArg?.taskConfig.initialConversation?.autoApprove).toBe(true);
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

  it('scopes stored task names and branches to each automation run', async () => {
    vi.mocked(projectManager.getProject).mockReturnValue({} as never);
    vi.mocked(generateTaskName).mockImplementation(({ title }) =>
      title === 'stored-task-branch' ? 'stored-task-branch-run' : 'stored-task-run'
    );
    vi.mocked(taskService.createTask).mockResolvedValueOnce({
      success: true,
      data: { task: {} as never },
    });

    const result = await executeTaskCreate(automation.actions[0]!, { automation, run });

    expect(result.success).toBe(true);
    const createArg = vi.mocked(taskService.createTask).mock.calls[0]?.[0];
    expect(createArg?.taskConfig.name).toBe('stored-task-run');
    expect(createArg?.workspaceConfig.git).toEqual({
      kind: 'create-branch',
      branchName: 'stored-task-branch-run',
      fromBranch: { type: 'local', branch: 'main' },
      pushBranch: false,
    });
    expect(generateTaskName).toHaveBeenCalledWith({ title: 'Stored task', description: run.id });
    expect(generateTaskName).toHaveBeenCalledWith({
      title: 'stored-task-branch',
      description: run.id,
    });
  });

  it('preserves none git and byoi workspace for BYOI automation tasks', async () => {
    vi.mocked(projectManager.getProject).mockReturnValue({} as never);
    vi.mocked(taskService.createTask).mockResolvedValueOnce({
      success: true,
      data: { task: {} as never },
    });

    const result = await executeTaskCreate(automation.actions[0]!, {
      automation: {
        ...automation,
        taskConfig: {
          ...automation.taskConfig!,
          workspaceConfig: {
            version: '2' as const,
            git: { kind: 'none' as const },
            workspace: { kind: 'byoi' as const },
          },
        },
      },
      run,
    });

    expect(result.success).toBe(true);
    const taskConfig = vi.mocked(taskService.createTask).mock.calls[0]?.[0];
    expect(taskConfig?.workspaceConfig.git).toEqual({ kind: 'none' });
    expect(taskConfig?.workspaceConfig.workspace).toEqual({ kind: 'byoi' });
  });

  it('uses the run id when generating default task names', async () => {
    vi.mocked(projectManager.getProject).mockReturnValue({
      defaultWorkspaceType: { kind: 'local' },
      repository: {
        getBranchesPayload: vi.fn().mockResolvedValue({
          gitDefaultBranch: 'main',
          branches: [{ type: 'local', branch: 'main' }],
        }),
        getRepositoryInfo: vi.fn().mockResolvedValue({ isUnborn: false, currentBranch: 'main' }),
        getConfiguredRemotes: vi.fn().mockResolvedValue({ baseRemote: 'origin' }),
      },
    } as never);
    vi.mocked(taskService.createTask).mockResolvedValueOnce({
      success: true,
      data: { task: {} as never },
    });

    await executeTaskCreate(automation.actions[0]!, {
      automation: { ...automation, taskConfig: null },
      run,
    });

    expect(generateTaskName).toHaveBeenCalledWith({
      title: 'Daily follow-up',
      description: 'run-1',
    });
  });

  it('enables auto-approval for Cursor when building automation task config from defaults', async () => {
    vi.mocked(appSettingsService.get).mockImplementation(async (key) =>
      key === 'defaultAgent' ? 'cursor' : (null as never)
    );
    vi.mocked(projectManager.getProject).mockReturnValue({
      defaultWorkspaceType: { kind: 'local' },
      repository: {
        getBranchesPayload: vi.fn().mockResolvedValue({
          gitDefaultBranch: 'main',
          branches: [{ type: 'local', branch: 'main' }],
        }),
        getRepositoryInfo: vi.fn().mockResolvedValue({ isUnborn: false, currentBranch: 'main' }),
        getConfiguredRemotes: vi.fn().mockResolvedValue({ baseRemote: 'origin' }),
      },
    } as never);
    vi.mocked(taskService.createTask).mockResolvedValueOnce({
      success: true,
      data: { task: {} as never },
    });

    await executeTaskCreate(automation.actions[0]!, {
      automation: { ...automation, taskConfig: null },
      run,
    });

    const createArg = vi.mocked(taskService.createTask).mock.calls[0]?.[0];
    expect(createArg?.taskConfig.initialConversation?.provider).toBe('cursor');
    expect(createArg?.taskConfig.initialConversation?.autoApprove).toBe(true);
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
    expect(taskService.launch).toHaveBeenCalledWith(result.data.taskId);
    expect(createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        taskId: result.data.taskId,
        initialPrompt: 'Check things',
        isInitialConversation: true,
      })
    );
    expect(vi.mocked(taskService.launch).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(createConversation).mock.invocationCallOrder[0]
    );
  });

  it('returns the task id when provisioning fails after task creation', async () => {
    vi.mocked(projectManager.getProject).mockReturnValue({} as never);
    vi.mocked(taskService.createTask).mockResolvedValueOnce({
      success: true,
      data: { task: {} as never },
    });
    vi.mocked(taskService.launch).mockResolvedValueOnce({
      success: false,
      error: {
        type: 'setup-failed',
        stepKind: 'workspace-acquire',
        stepErrorType: 'error',
        message: 'provisioning failed',
      },
    });

    const result = await executeTaskCreate(automation.actions[0]!, { automation, run });

    expect(result).toEqual({
      success: false,
      error: {
        message: "Setup step 'workspace-acquire' failed (error): provisioning failed.",
        taskId: expect.any(String),
      },
    });
    expect(createConversation).not.toHaveBeenCalled();
  });

  it('returns the task id when persisting the run task link fails', async () => {
    vi.mocked(projectManager.getProject).mockReturnValue({} as never);
    vi.mocked(taskService.createTask).mockResolvedValueOnce({
      success: true,
      data: { task: {} as never },
    });
    vi.mocked(updateRun).mockResolvedValueOnce(null);

    const result = await executeTaskCreate(automation.actions[0]!, { automation, run });

    expect(result).toEqual({
      success: false,
      error: { message: 'run_update_failed', taskId: expect.any(String) },
    });
    expect(taskService.launch).not.toHaveBeenCalled();
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
    expect(taskService.launch).not.toHaveBeenCalled();
    expect(createConversation).not.toHaveBeenCalled();
  });
});
