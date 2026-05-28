import { telemetryService } from '@main/lib/telemetry';
import type { CreateTaskParams, Task } from '@shared/tasks';
import { taskCreatedTelemetryStrategy } from './task-created-strategy';

export function captureTaskCreatedTelemetry(task: Task, params: CreateTaskParams): void {
  telemetryService.capture('task_created', {
    strategy: taskCreatedTelemetryStrategy(params),
    has_initial_prompt: Boolean(params.initialConversation?.initialPrompt?.trim()),
    has_issue: params.linkedIssue?.provider ?? 'none',
    provider: params.initialConversation?.provider ?? null,
    project_id: task.projectId,
    task_id: task.id,
  });

  if (params.linkedIssue) {
    telemetryService.capture('issue_linked_to_task', {
      provider: params.linkedIssue.provider,
      project_id: task.projectId,
      task_id: task.id,
    });
  }
}

export function captureTaskProvisionedTelemetry(projectId: string, taskId: string): void {
  telemetryService.capture('task_provisioned', { project_id: projectId, task_id: taskId });
}
