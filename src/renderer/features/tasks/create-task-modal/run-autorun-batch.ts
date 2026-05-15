import { toast } from 'sonner';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { Branch } from '@shared/git';
import { formatIssueAsPrompt, type Issue } from '@shared/tasks';
import type { TaskManagerStore } from '@renderer/features/tasks/stores/task-manager';
import { normalizeTaskName } from '@renderer/utils/taskNames';

export interface AutorunBatchOptions {
  projectId: string;
  sourceBranch: Branch;
  provider: AgentProviderId | null;
  concurrency: number;
  autoCreatePr: boolean;
  extraPromptPrefix?: string;
}

function buildTaskName(issue: Issue): string {
  const base = `${issue.identifier ?? ''}-${issue.title ?? 'task'}`;
  const normalized = normalizeTaskName(base);
  return normalized || `issue-${Date.now().toString(36)}`;
}

function buildInitialPrompt(issue: Issue, extraPrefix?: string): string {
  return formatIssueAsPrompt(issue, extraPrefix?.trim() || undefined);
}

/**
 * Runs `taskManager.createTask` for every issue, capped at `concurrency` in flight.
 * Each `createTask` resolves only after provisioning completes, so the workers
 * naturally rate-limit concurrent worktree setups.
 */
export async function runAutorunBatch(
  taskManager: TaskManagerStore,
  issues: Issue[],
  opts: AutorunBatchOptions
): Promise<{ started: number; failed: number }> {
  const queue = [...issues];
  let started = 0;
  let failed = 0;
  const workers = Array.from({ length: Math.max(1, opts.concurrency) }, async () => {
    while (queue.length > 0) {
      const issue = queue.shift();
      if (!issue) break;
      const taskName = buildTaskName(issue);
      const taskId = crypto.randomUUID();
      try {
        await taskManager.createTask({
          id: taskId,
          projectId: opts.projectId,
          name: taskName,
          sourceBranch: opts.sourceBranch,
          strategy: { kind: 'new-branch', taskBranch: taskName },
          linkedIssue: issue,
          autoCreatePr: opts.autoCreatePr,
          initialConversation: opts.provider
            ? {
                id: crypto.randomUUID(),
                projectId: opts.projectId,
                taskId,
                provider: opts.provider,
                title: taskName,
                initialPrompt: buildInitialPrompt(issue, opts.extraPromptPrefix),
                // Autorun is fire-and-forget: the agent must not pause on permission prompts.
                autoApprove: true,
              }
            : undefined,
        });
        started += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`Task for ${issue.identifier ?? issue.title}: ${message}`);
      }
    }
  });
  await Promise.all(workers);
  return { started, failed };
}
