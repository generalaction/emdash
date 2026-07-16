import { describe, expect, it } from 'vitest';
import type { LifecycleOperationRow, ProjectRow, TaskRow, WorkspaceRow } from '@main/db/schema';
import { compileDeleteTaskPlan } from './delete-task-plan';
import type { TaskOperationProbe } from './probe-task-state';

const task: TaskRow = {
  id: 'task-1',
  projectId: 'project-1',
  name: 'Task',
  status: 'in_progress',
  sourceBranch: null,
  taskBranch: null,
  linkedIssue: null,
  archivedAt: null,
  createdAt: '2026-07-15',
  updatedAt: '2026-07-15',
  lastInteractedAt: null,
  statusChangedAt: '2026-07-15',
  isPinned: 0,
  workspaceProvider: null,
  workspaceId: 'workspace-1',
  workspaceProviderData: null,
  workspaceIntent: null,
  type: 'task',
  automationRunId: null,
  deletedAt: '2026-07-15',
};

const workspace: WorkspaceRow = {
  id: 'workspace-1',
  key: 'local:/repo/task',
  type: 'local',
  kind: 'worktree',
  location: 'local',
  sshConnectionId: null,
  data: null,
  path: '/repo/task',
  config: null,
  branchName: 'task-branch',
  linesAdded: null,
  linesDeleted: null,
  createdAt: '2026-07-15',
  updatedAt: '2026-07-15',
  deletedAt: null,
};

const project: ProjectRow = {
  id: 'project-1',
  name: 'Project',
  path: '/repo',
  workspaceProvider: 'local',
  baseRef: null,
  sshConnectionId: null,
  repositoryWorkspaceId: null,
  createdAt: '2026-07-15',
  updatedAt: '2026-07-15',
  deletedAt: null,
};

function operation(payload: Partial<LifecycleOperationRow['payload']> = {}): LifecycleOperationRow {
  return {
    id: 'operation-1',
    kind: 'delete-task',
    status: 'pending',
    projectId: project.id,
    taskId: task.id,
    workspaceId: workspace.id,
    entityKey: task.id,
    hostRef: 'local',
    payload: {
      version: '1',
      source: 'user',
      deleteWorktree: true,
      ...payload,
    },
    attempt: 0,
    error: null,
    createdAt: 1,
    finishedAt: null,
  };
}

function probe(values: Partial<TaskOperationProbe> = {}): TaskOperationProbe {
  return {
    task,
    workspace,
    project,
    acpConversationCount: 0,
    tuiConversationCount: 0,
    terminalCount: 0,
    ...values,
  };
}

describe('compileDeleteTaskPlan', () => {
  it('converges an already-purged task without steps', () => {
    expect(
      compileDeleteTaskPlan(
        {
          acpConversationCount: 0,
          tuiConversationCount: 0,
          terminalCount: 0,
        },
        operation()
      )
    ).toEqual({ kind: 'delete-task', steps: [] });
  });

  it('cleans explicit orphan sessions without purging an owner', () => {
    const plan = compileDeleteTaskPlan(
      {
        acpConversationCount: 0,
        tuiConversationCount: 0,
        terminalCount: 0,
      },
      operation({
        source: 'reconciler',
        acpConversationIds: ['acp-orphan'],
        terminalSessionIds: ['project-1:task-1:terminal-orphan'],
      })
    );

    expect(plan.steps.map((step) => step.kind)).toEqual(['kill-acp-sessions', 'kill-tui-sessions']);
    expect(plan.steps.every((step) => !step.destructive)).toBe(true);
  });

  it('orders all cleanup steps and marks destructive work', () => {
    const plan = compileDeleteTaskPlan(
      probe({
        acpConversationCount: 1,
        tuiConversationCount: 2,
        terminalCount: 1,
        automation: {
          teardown: 'pnpm teardown',
          autoRunSetup: true,
          autoRunRun: false,
        },
      }),
      operation()
    );

    expect(plan.steps.map((step) => step.kind)).toEqual([
      'kill-acp-sessions',
      'kill-tui-sessions',
      'deactivate-workspace',
      'teardown-workspace',
      'purge-task-rows',
    ]);
    expect(plan.steps.map((step) => step.destructive)).toEqual([false, false, true, true, true]);
  });

  it('keeps the worktree when requested while still purging task data', () => {
    const plan = compileDeleteTaskPlan(probe(), operation({ deleteWorktree: false }));

    expect(plan.steps.map((step) => step.kind)).toEqual([
      'deactivate-workspace',
      'purge-task-rows',
    ]);
  });

  it('never tears down a project-root workspace', () => {
    const plan = compileDeleteTaskPlan(
      probe({ workspace: { ...workspace, kind: 'project-root' } }),
      operation()
    );

    expect(plan.steps.some((step) => step.kind === 'teardown-workspace')).toBe(false);
    expect(plan.steps.at(-1)?.kind).toBe('purge-task-rows');
  });

  it('only purges rows when no workspace was provisioned', () => {
    const plan = compileDeleteTaskPlan(probe({ workspace: undefined }), operation());
    expect(plan.steps.map((step) => step.kind)).toEqual(['purge-task-rows']);
  });
});
