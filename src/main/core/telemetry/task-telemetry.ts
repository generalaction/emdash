import { telemetryService } from '@main/lib/telemetry';
import { taskService } from '../tasks/task-service';
import { taskSessionManager } from '../tasks/task-session-manager';

taskService.on('task:created', (task, params) => {
  const { gitSetup } = params;
  const taskCreatedStrategy = (() => {
    if (gitSetup.kind === 'pr-branch') return 'pr';
    if (params.linkedIssue) return 'issue';
    if (gitSetup.kind === 'none') return 'blank';
    return 'branch';
  })();
  telemetryService.capture('task_created', {
    strategy: taskCreatedStrategy,
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
});

taskSessionManager.hooks.on('task:provisioned', ({ projectId, taskId }) => {
  telemetryService.capture('task_provisioned', { project_id: projectId, task_id: taskId });
});
