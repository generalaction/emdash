import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { conversations, projects, tasks, type TaskRow } from '../../db/schema';
import { log } from '../../lib/logger';
import { err, ok, Result } from '../../lib/result';
import { spawnLocalPty } from '../../pty/local-pty';
import { buildSessionEnv } from '../../pty/pty-env';
import { ensureProjectSettings } from '../projects/ensureProjectSettings';
import { worktreePoolService } from '../worktrees/WorktreePoolService';
import { worktreeService } from '../worktrees/WorktreeService';
import type { Task, TaskMetadata } from './core';

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
    path: row.path,
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
    runSetupScript(taskRow.id, worktree.path, setupScript);
  }

  return ok({ task: mapTaskRow(taskRow), conversationId });
}

function runSetupScript(taskId: string, taskPath: string, command: string): void {
  let buffer = '';

  const env = buildSessionEnv('lifecycle');
  const shell = process.env.SHELL ?? '/bin/sh';
  const result = spawnLocalPty({
    id: crypto.randomUUID(),
    command: shell,
    args: ['-c', command],
    cwd: taskPath,
    env,
    cols: 80,
    rows: 24,
  });

  if (!result.success) {
    log.error('createTask: setup script spawn failed', { taskId, error: result.error });
    return;
  }

  const pty = result.data;
  pty.onData((chunk) => {
    buffer += chunk;
  });
  pty.onExit(({ exitCode }) => {
    db.update(tasks)
      .set({ setupScriptBuffer: buffer })
      .where(eq(tasks.id, taskId))
      .catch((e) =>
        log.error('createTask: failed to write setup script buffer', { taskId, error: e })
      );
    log.info('createTask: setup script finished', { taskId, exitCode });
  });
}
