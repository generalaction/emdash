import type {
  Label,
  MergeableState,
  MergeStateStatus,
  PullRequest,
  PullRequestCheck,
  PullRequestStatus,
  PullRequestUser,
} from '@shared/pull-requests';
import {
  pullRequestAssignees,
  pullRequestChecks,
  pullRequestLabels,
  pullRequests,
  pullRequestUsers,
} from '@main/db/schema';

export type PrRow = typeof pullRequests.$inferSelect;
export type PrUserRow = typeof pullRequestUsers.$inferSelect;
export type PrLabelRow = typeof pullRequestLabels.$inferSelect;
export type PrAssigneeRow = typeof pullRequestAssignees.$inferSelect;
export type PrCheckRow = typeof pullRequestChecks.$inferSelect;

/** Convert a raw DB pull_request_users row to the shared PullRequestUser type. */
export function dbRowToUserRow(row: PrUserRow): PullRequestUser {
  return {
    userId: row.userId,
    userName: row.userName,
    displayName: row.displayName ?? null,
    avatarUrl: row.avatarUrl ?? null,
    url: row.url ?? null,
    userUpdatedAt: row.userUpdatedAt ?? null,
    userCreatedAt: row.userCreatedAt ?? null,
  };
}

/** Convert a raw DB pull_request_checks row to the shared PullRequestCheck type. */
export function dbRowToCheckRow(row: PrCheckRow): PullRequestCheck {
  return {
    id: row.id,
    pullRequestUrl: row.pullRequestUrl,
    commitSha: row.commitSha,
    name: row.name,
    status: row.status,
    conclusion: row.conclusion ?? null,
    detailsUrl: row.detailsUrl ?? null,
    startedAt: row.startedAt ?? null,
    completedAt: row.completedAt ?? null,
    workflowName: row.workflowName ?? null,
    appName: row.appName ?? null,
    appLogoUrl: row.appLogoUrl ?? null,
  };
}

/** Assemble the fully denormalised PullRequest view from a DB row + related data. */
export function assemblePullRequest(
  row: PrRow,
  author: PrUserRow | null,
  labels: PrLabelRow[],
  assignees: PrUserRow[],
  checks: PrCheckRow[] = []
): PullRequest {
  return {
    url: row.url,
    provider: row.provider,
    repositoryUrl: row.repositoryUrl,
    baseRefName: row.baseRefName,
    baseRefOid: row.baseRefOid,
    headRepositoryUrl: row.headRepositoryUrl,
    headRefName: row.headRefName,
    headRefOid: row.headRefOid,
    identifier: row.identifier ?? null,
    title: row.title,
    description: row.description ?? null,
    status: row.status as PullRequestStatus,
    isDraft: Boolean(row.isDraft),
    additions: row.additions ?? null,
    deletions: row.deletions ?? null,
    changedFiles: row.changedFiles ?? null,
    commitCount: row.commitCount ?? null,
    mergeableStatus: (row.mergeableStatus as MergeableState | null) ?? null,
    mergeStateStatus: (row.mergeStateStatus as MergeStateStatus | null) ?? null,
    reviewDecision: row.reviewDecision ?? null,
    createdAt: row.pullRequestCreatedAt,
    updatedAt: row.pullRequestUpdatedAt,
    author: author ? dbRowToUserRow(author) : null,
    labels: labels.map((l) => ({ name: l.name, color: l.color ?? null }) satisfies Label),
    assignees: assignees.map(dbRowToUserRow),
    checks: checks.map(dbRowToCheckRow),
  };
}
