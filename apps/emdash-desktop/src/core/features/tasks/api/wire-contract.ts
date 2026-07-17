import type { Result } from '@emdash/shared';
import {
  defineContract,
  eventStream,
  fallible,
  liveModel,
  liveState,
  procedure,
} from '@emdash/wire';
import z from 'zod';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';
import {
  deletionListSchema,
  deletionModelKeySchema,
  deletionMutationErrorSchema,
  deletionMutationResultSchema,
} from '@core/primitives/operations/api';
import {
  taskLifecycleStatuses,
  type CreateTaskError,
  type CreateTaskParams,
  type CreateTaskSuccess,
  type DeletePreflightResult,
  type DeleteTaskOptions,
  type RenameTaskError,
  type RenameTaskSuccess,
  type Task,
  type TaskEvent,
} from '@core/primitives/tasks/api';
import type { ProjectWorkspace } from '@core/primitives/workspaces/api';

export const deleteTaskInputSchema = z.object({
  taskId: z.string(),
  deleteWorktree: z.boolean().optional(),
  deleteBranch: z.boolean().optional(),
});

const taskIdInputSchema = z.object({
  taskId: z.string(),
});

export const tasksWireContract = defineContract({
  createTask: procedure({
    input: z.custom<CreateTaskParams>(),
    output: z.custom<Result<CreateTaskSuccess, CreateTaskError>>(),
  }),
  getTasks: procedure({
    input: z.object({ projectId: z.string().optional() }),
    output: z.custom<Task[]>(),
  }),
  getDeletePreflight: procedure({
    input: z.object({ projectId: z.string(), taskIds: z.array(z.string()) }),
    output: z.custom<DeletePreflightResult>(),
  }),
  deleteTask: procedure({
    input: z.object({
      projectId: z.string(),
      taskId: z.string(),
      options: z.custom<DeleteTaskOptions>().optional(),
    }),
    output: z.void(),
  }),
  deleteTasks: procedure({
    input: z.object({
      projectId: z.string(),
      taskIds: z.array(z.string()),
      options: z.custom<DeleteTaskOptions>().optional(),
    }),
    output: z.void(),
  }),
  archiveTask: procedure({
    input: z.object({ projectId: z.string(), taskId: z.string() }),
    output: z.void(),
  }),
  restoreTask: procedure({
    input: taskIdInputSchema,
    output: z.void(),
  }),
  renameTask: procedure({
    input: z.object({ projectId: z.string(), taskId: z.string(), newName: z.string() }),
    output: z.custom<Result<RenameTaskSuccess, RenameTaskError>>(),
  }),
  updateLinkedIssue: procedure({
    input: z.object({ taskId: z.string(), issue: z.custom<LinkedIssue>().optional() }),
    output: z.void(),
  }),
  updateTaskStatus: procedure({
    input: z.object({ taskId: z.string(), status: taskLifecycleStatuses }),
    output: z.void(),
  }),
  setTaskPinned: procedure({
    input: z.object({ taskId: z.string(), isPinned: z.boolean() }),
    output: z.void(),
  }),
  convertAutomationTask: procedure({
    input: taskIdInputSchema,
    output: z.custom<Task | null>(),
  }),
  getProjectWorkspaces: procedure({
    input: z.object({ projectId: z.string() }),
    output: z.custom<ProjectWorkspace[]>(),
  }),
  teardownTask: procedure({
    input: z.object({ projectId: z.string(), taskId: z.string() }),
    output: z.custom<Result<void, { type: string; message: string; timeout?: number }>>(),
  }),
  generateTaskName: procedure({
    input: z.object({ title: z.string().optional(), description: z.string().optional() }),
    output: z.string(),
  }),
  events: eventStream({ key: z.void(), event: z.custom<TaskEvent>() }),
  delete: fallible({
    input: deleteTaskInputSchema,
    data: deletionMutationResultSchema,
    error: deletionMutationErrorSchema,
  }),
  retryDelete: fallible({
    input: taskIdInputSchema,
    data: deletionMutationResultSchema,
    error: deletionMutationErrorSchema,
  }),
  forgetWithoutCleanup: fallible({
    input: taskIdInputSchema,
    data: deletionMutationResultSchema,
    error: deletionMutationErrorSchema,
  }),
  deletions: liveModel({
    key: deletionModelKeySchema,
    states: {
      list: liveState({ data: deletionListSchema }),
    },
  }),
});

export type DeleteTaskInput = z.infer<typeof deleteTaskInputSchema>;
export type TasksWireContract = typeof tasksWireContract;
