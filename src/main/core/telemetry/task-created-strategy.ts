import type { CreateTaskParams } from '@shared/tasks';
import { TASK_KIND } from '@shared/tasks';
import type { TaskCreatedTelemetryStrategy } from '@shared/telemetry';

export function taskCreatedTelemetryStrategy(
  params: Pick<CreateTaskParams, 'kind' | 'linkedIssue' | 'strategy'>
): TaskCreatedTelemetryStrategy {
  if (params.kind === TASK_KIND.Chat) return 'chat';
  if (params.strategy.kind === 'from-pull-request') return 'pr';
  if (params.linkedIssue) return 'issue';
  if (params.strategy.kind === 'no-worktree') return 'blank';
  return 'branch';
}
