import type { CreateConversationParams } from '@shared/conversations';
import type { Issue, TaskLifecycleStatus } from '@shared/tasks';

// ---------------------------------------------------------------------------
// v1 — TaskConfig groups the task-identity fields that travel with a task.
// ---------------------------------------------------------------------------

export type TaskConfig = {
  version: '1';
  name: string;
  linkedIssue?: Issue;
  initialConversation?: CreateConversationParams;
  initialStatus?: TaskLifecycleStatus;
};

export function parseTaskConfig(raw: string | null | undefined): TaskConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    if ((parsed as { version?: unknown }).version === '1') return parsed as TaskConfig;
    return null;
  } catch {
    return null;
  }
}

export function serializeTaskConfig(config: TaskConfig): string {
  return JSON.stringify(config);
}
