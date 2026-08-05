import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@main/db/client';
import { projectRemotes, pullRequests, tasks, workspaces } from '@main/db/schema';
import { pullRequestRepositoryScope } from './pr-utils';

export type PrAutoCleanupCandidate = {
  taskId: string;
  projectId: string;
  taskName: string;
  prUrl: string;
};

type CandidateRow = PrAutoCleanupCandidate & {
  prStatus: string;
  prCreatedAt: string;
};

/**
 * Returns the current PR for each active task on a repository, using the same rule as
 * the renderer: prefer an open PR, otherwise use the most recently created PR. Only
 * tasks whose current PR is merged are eligible for cleanup.
 */
export async function listPrAutoCleanupCandidates(
  repositoryUrl: string
): Promise<PrAutoCleanupCandidate[]> {
  const rows: CandidateRow[] = await db
    .select({
      taskId: tasks.id,
      projectId: tasks.projectId,
      taskName: tasks.name,
      prUrl: pullRequests.url,
      prStatus: pullRequests.status,
      prCreatedAt: pullRequests.pullRequestCreatedAt,
    })
    .from(tasks)
    .innerJoin(workspaces, eq(tasks.workspaceId, workspaces.id))
    .innerJoin(
      pullRequests,
      and(
        pullRequestRepositoryScope([repositoryUrl]),
        eq(pullRequests.headRefName, workspaces.branchName)
      )
    )
    .innerJoin(
      projectRemotes,
      and(
        eq(projectRemotes.projectId, tasks.projectId),
        eq(projectRemotes.remoteUrl, pullRequests.headRepositoryUrl)
      )
    )
    .where(isNull(tasks.archivedAt))
    .orderBy(desc(pullRequests.pullRequestCreatedAt));

  const currentByTask = new Map<string, CandidateRow>();
  for (const row of rows) {
    const current = currentByTask.get(row.taskId);
    if (!current || (current.prStatus !== 'open' && row.prStatus === 'open')) {
      currentByTask.set(row.taskId, row);
    }
  }

  return Array.from(currentByTask.values()).flatMap((row) =>
    row.prStatus === 'merged'
      ? [
          {
            taskId: row.taskId,
            projectId: row.projectId,
            taskName: row.taskName,
            prUrl: row.prUrl,
          },
        ]
      : []
  );
}
