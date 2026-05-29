import type { CreateTaskParams } from '@shared/tasks';
import { TASK_KIND, resolveTaskKind } from '@shared/tasks';
import type { TaskCreatedTelemetryStrategy } from '@shared/telemetry';

/** Precedence: chat > pr > issue > blank/branch (by create strategy). */
export function taskCreatedTelemetryStrategy(
  params: Pick<CreateTaskParams, 'kind' | 'linkedIssue' | 'strategy'>
): TaskCreatedTelemetryStrategy {
  if (resolveTaskKind(params.kind) === TASK_KIND.Chat) return 'chat';
  if (params.strategy.kind === 'from-pull-request') return 'pr';
  if (params.linkedIssue) return 'issue';

  switch (params.strategy.kind) {
    case 'no-worktree':
      return 'blank';
    case 'new-branch':
    case 'checkout-existing':
      return 'branch';
  }
}
