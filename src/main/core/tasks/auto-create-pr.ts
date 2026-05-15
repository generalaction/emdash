import { eq, sql } from 'drizzle-orm';
import { agentSessionExitedChannel, type AgentSessionExited } from '@shared/events/agentEvents';
import type { Issue } from '@shared/tasks';
import { projectManager } from '@main/core/projects/project-manager';
import { resolveWorkspace } from '@main/core/projects/utils';
import { prQueryService } from '@main/core/pull-requests/pr-query-service';
import { prSyncEngine } from '@main/core/pull-requests/pr-sync-engine';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';

async function handleAgentExit(event: AgentSessionExited): Promise<void> {
  if (event.exitCode !== 0) return;

  const [row] = await db.select().from(tasks).where(eq(tasks.id, event.taskId)).limit(1);
  if (!row || row.autoCreatePr !== 1) return;
  // Clear the flag immediately so a respawn or repeat exit cannot fire a duplicate PR.
  await db.update(tasks).set({ autoCreatePr: 0 }).where(eq(tasks.id, event.taskId));

  if (!row.taskBranch) return;

  const linkedIssue: Issue | undefined = row.linkedIssue
    ? (JSON.parse(row.linkedIssue) as Issue)
    : undefined;
  if (linkedIssue?.provider !== 'github') return;

  const project = projectManager.getProject(event.projectId);
  if (!project) return;
  const remoteInfo = await prQueryService.getProjectRemoteInfo(event.projectId);
  if (remoteInfo.status !== 'ready') return;

  const workspaceId = row.workspaceId;
  if (!workspaceId) return;

  const workspace = resolveWorkspace(event.projectId, workspaceId);
  if (!workspace) return;

  const remoteName = await project.repository.getConfiguredRemote().catch(() => 'origin');
  const publishResult = await workspace.git.publishBranch(row.taskBranch, remoteName);
  if (!publishResult.success) {
    log.warn('auto-create-pr: publish branch failed', {
      taskId: event.taskId,
      branch: row.taskBranch,
      error: publishResult.error,
    });
    return;
  }

  const baseBranch = await project.settings.getDefaultBranch();
  const issueIdentifier = linkedIssue.identifier?.replace(/^#/, '') ?? '';
  const closesLine = issueIdentifier ? `Closes #${issueIdentifier}\n\n` : '';
  const body = `${closesLine}${linkedIssue.description ?? ''}`.trim() || undefined;

  try {
    const result = await prSyncEngine.createPullRequest({
      repositoryUrl: remoteInfo.repositoryUrl,
      head: row.taskBranch,
      base: baseBranch,
      title: linkedIssue.title || row.name,
      body,
      draft: true,
    });
    if (!result.success) {
      log.warn('auto-create-pr: createPullRequest failed', {
        taskId: event.taskId,
        error: result.error,
      });
      return;
    }
    void prSyncEngine.syncSingle(remoteInfo.repositoryUrl, result.data.number);
    telemetryService.capture('pr_created', { is_draft: true });
    // Bump updatedAt so renderer task list refresh picks up the linked PR sync.
    await db
      .update(tasks)
      .set({ updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(tasks.id, event.taskId));
  } catch (error) {
    log.warn('auto-create-pr: unexpected failure', {
      taskId: event.taskId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

events.on(agentSessionExitedChannel, (event) => {
  void handleAgentExit(event).catch((error) => {
    log.error('auto-create-pr: handler threw', { error });
  });
});
