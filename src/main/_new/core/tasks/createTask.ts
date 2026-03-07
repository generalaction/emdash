import { db } from '../../db/client';
import { tasks, conversations, projects } from '../../db/schema';
import { eq, sql } from 'drizzle-orm';
import { worktreeService } from '../../../services/WorktreeService';
import { worktreePoolService } from '../../../services/WorktreePoolService';
import { err, ok, Result } from '../../../lib/result';
import type { Task, TaskMetadata } from './core';
import type { TaskRow, ProjectRow } from '../../db/schema';
import { ensureProjectSettings } from '../projects/ensureProjectSettings';
import { ptySessionManager } from '../../pty/session/core';
import { taskResourceManager } from '../../environment/task-resource-manager';
import { log } from '../../lib/logger';

export type LinkedIssue =
  | { source: 'github'; number: number; title: string; url?: string; body?: string }
  | { source: 'linear'; identifier: string; title: string; url?: string; description?: string }
  | { source: 'jira'; key: string; summary: string; url?: string };

export type CreateTaskParams = {
  projectId: string;
  name: string;
  useWorktree: boolean;
  linkedIssue?: LinkedIssue;
  sourceBranch?: string;
  initialConversation: {
    agentId: string;
    initialPrompt?: string;
  };
};

export type CreateTaskError =
  | { type: 'project_not_found' }
  | { type: 'worktree_failed'; message: string }
  | { type: 'db_failed'; message: string }
  | { type: 'project_settings_failed'; message: string };

export type CreateTaskResult = { task: Task; conversationId: string };

export function mapTaskRow(row: TaskRow): Task {
  const meta: TaskMetadata = row.metadata ? JSON.parse(row.metadata) : {};
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    status: meta.lifecycleStatus ?? 'in_progress',
    sourceBranch: meta.sourceBranch ?? '',
    branch: row.branch,
    linkedIssue: meta.linkedIssue,
    archivedAt: row.archivedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    initialConversation: {
      agentId: row.agentId ?? '',
      initialPrompt: meta.initialPrompt ?? '',
    },
  };
}

export async function createTask(
  params: CreateTaskParams
): Promise<Result<CreateTaskResult, CreateTaskError>> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, params.projectId))
    .limit(1);

  if (!project) return err({ type: 'project_not_found' });

  const effectiveBaseRef = params.sourceBranch ?? project.baseRef ?? undefined;

  const projectSettings = ensureProjectSettings(project.path);
  if (!projectSettings.success)
    return err({ type: 'project_settings_failed', message: projectSettings.error.kind });

  let worktree;
  try {
    const claim = await worktreePoolService.claimReserve(
      params.projectId,
      project.path,
      params.name,
      effectiveBaseRef
    );
    worktree =
      claim?.worktree ??
      (await worktreeService.createWorktree(
        project.path,
        params.name,
        params.projectId,
        effectiveBaseRef
      ));
  } catch (e) {
    return err({ type: 'worktree_failed', message: (e as Error).message });
  }

  const metadata: TaskMetadata = {
    lifecycleStatus: 'todo',
    linkedIssue: params.linkedIssue,
    sourceBranch: effectiveBaseRef,
    initialPrompt: params.initialConversation.initialPrompt,
  };

  let taskRow: TaskRow;
  try {
    [taskRow] = await db
      .insert(tasks)
      .values({
        id: worktree.id,
        projectId: params.projectId,
        name: params.name,
        branch: worktree.branch,
        path: worktree.path,
        status: 'todo',
        agentId: params.initialConversation.agentId,
        metadata: JSON.stringify(metadata),
        useWorktree: params.useWorktree ? 1 : 0,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .returning();
  } catch (e) {
    return err({ type: 'db_failed', message: (e as Error).message });
  }

  const conversationId = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const agentSessionId = crypto.randomUUID();

  await db.insert(conversations).values({
    id: conversationId,
    taskId: taskRow.id,
    title: params.name,
    provider: params.initialConversation.agentId,
    isMain: 1,
    isActive: 1,
    displayOrder: 0,
    type: 'agent',
    agentSessionId,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  });

  const setupScript = projectSettings.data.scripts?.setup?.trim();
  if (setupScript) {
    runSetupScript(taskRow.id, worktree.path, project, setupScript);
  }

  return ok({ task: mapTaskRow(taskRow), conversationId });
}

function runSetupScript(
  taskId: string,
  taskPath: string,
  project: ProjectRow,
  command: string
): void {
  let buffer = '';

  taskResourceManager
    .getOrProvision(project, { id: taskId, path: taskPath })
    .then((env) => {
      return ptySessionManager.createSession({
        type: 'lifecycle',
        config: {
          taskId,
          phase: 'setup',
          cwd: taskPath,
          command,
          onExit: (exitCode) => {
            db.update(tasks)
              .set({ setupScriptBuffer: buffer })
              .where(eq(tasks.id, taskId))
              .catch((e) =>
                log.error('createTask: failed to write setup script buffer', { taskId, error: e })
              );
            log.info('createTask: setup script finished', { taskId, exitCode });
          },
        },
        transport:
          env.transport === 'ssh2' && env.connectionId
            ? { type: 'ssh2', connectionId: env.connectionId }
            : { type: 'local' },
      });
    })
    .then((result) => {
      if (!result.success) {
        log.error('createTask: setup script spawn failed', { taskId, error: result.error });
        return;
      }
      result.data.pty.onData((chunk) => {
        buffer += chunk;
      });
    })
    .catch((e) =>
      log.error('createTask: unexpected setup script error', { taskId, error: String(e) })
    );
}
