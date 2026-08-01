import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commitCreateTask,
  finalizeCreateTask,
  prepareCreateTask,
} from '@main/core/tasks/operations/createTask';
import { db } from '@main/db/client';
import { createTaskWithLoop } from './create-task-with-loop';
import { commitPreparedLoop, prepareNewLoop } from './loop-operations';

vi.mock('@main/core/tasks/operations/createTask', () => ({
  prepareCreateTask: vi.fn(),
  commitCreateTask: vi.fn(),
  finalizeCreateTask: vi.fn(),
}));

vi.mock('./loop-operations', () => ({
  prepareNewLoop: vi.fn(),
  commitPreparedLoop: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: { transaction: vi.fn() },
}));

const taskParams = {
  id: 'task-1',
  projectId: 'project-1',
  taskConfig: { version: '1' as const, name: 'Task' },
  workspaceConfig: {
    version: '2' as const,
    git: { kind: 'none' as const },
    workspace: { kind: 'repository-instance' as const, workspaceId: 'workspace-1' },
  },
};

const loopParams = {
  name: 'Task Loop',
  model: 'gpt-5.6-sol',
  planSource: '# Work',
  validationCommands: ['pnpm run test'],
  terminalGates: { review: true, e2e: true },
  browserPreview: { enabled: true },
  workPhases: [{ name: 'Work', goal: 'Implement it.' }],
  acceptanceCriteria: ['The native flow passes.'],
};

describe('createTaskWithLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prepareCreateTask).mockResolvedValue({
      success: true,
      data: { params: taskParams, initialStatus: 'in_progress', workspaceId: 'workspace-1' },
    } as never);
    vi.mocked(prepareNewLoop).mockReturnValue({
      success: true,
      data: { loopId: 'loop-1', phases: [] },
    } as never);
    vi.mocked(commitCreateTask).mockReturnValue({
      taskRow: { id: 'task-1' },
      convRow: undefined,
    } as never);
    vi.mocked(commitPreparedLoop).mockReturnValue({ id: 'loop-1', phases: [] } as never);
    vi.mocked(finalizeCreateTask).mockReturnValue({
      task: { id: 'task-1', projectId: 'project-1' },
    } as never);
    vi.mocked(db.transaction).mockImplementation(((callback: (tx: object) => void) => {
      callback({ transaction: 'shared' });
    }) as never);
  });

  it('commits the task and primary Loop in one transaction before finalizing', async () => {
    const result = await createTaskWithLoop({ task: taskParams, loop: loopParams });

    expect(result).toMatchObject({
      success: true,
      data: { task: { task: { id: 'task-1' } }, loop: { id: 'loop-1' } },
    });
    expect(db.transaction).toHaveBeenCalledOnce();
    const taskTx = vi.mocked(commitCreateTask).mock.calls[0]![1];
    const loopTx = vi.mocked(commitPreparedLoop).mock.calls[0]![1];
    expect(taskTx).toBe(loopTx);
    expect(vi.mocked(commitPreparedLoop).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(finalizeCreateTask).mock.invocationCallOrder[0]!
    );
  });

  it('rejects a normal initial conversation before any write', async () => {
    const result = await createTaskWithLoop({
      task: {
        ...taskParams,
        taskConfig: {
          ...taskParams.taskConfig,
          initialConversation: { id: 'conversation-1', provider: 'codex' },
        },
      },
      loop: loopParams,
    });

    expect(result).toMatchObject({ success: false, error: { kind: 'invalid-input' } });
    expect(prepareCreateTask).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('returns a DB error and never finalizes when the Loop insert aborts the transaction', async () => {
    vi.mocked(commitPreparedLoop).mockImplementationOnce(() => {
      throw new Error('primary loop conflict');
    });

    const result = await createTaskWithLoop({ task: taskParams, loop: loopParams });

    expect(result).toMatchObject({ success: false, error: { kind: 'db-error' } });
    expect(finalizeCreateTask).not.toHaveBeenCalled();
  });
});
