import { telemetryService } from '@main/lib/telemetry';
import { taskService } from '../tasks/task-service';
import { taskSessionManager } from '../tasks/task-session-manager';

taskService.on('task:created', (task, params) => {
  const { git } = params.workspaceConfig;
  const { linkedIssue, initialConversation } = params.taskConfig;
  const taskCreatedStrategy = (() => {
    if (git.kind === 'pr-branch') return 'pr';
    if (linkedIssue) return 'issue';
    if (git.kind === 'none') return 'blank';
    return 'branch';
  })();
  telemetryService.capture('task_created', {
    strategy: taskCreatedStrategy,
    has_initial_prompt: Boolean(initialConversation?.initialPrompt?.trim()),
    has_issue: linkedIssue?.provider ?? 'none',
    provider: initialConversation?.provider ?? null,
    project_id: task.projectId,
    task_id: task.id,
  });
  if (linkedIssue) {
    telemetryService.capture('issue_linked_to_task', {
      provider: linkedIssue.provider,
      project_id: task.projectId,
      task_id: task.id,
    });
  }
});

taskSessionManager.hooks.on('task:provisioned', ({ projectId, taskId }) => {
  telemetryService.capture('task_provisioned', { project_id: projectId, task_id: taskId });
});
