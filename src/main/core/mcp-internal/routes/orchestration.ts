import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { isValidProviderId, type AgentProviderId } from '@shared/agent-provider-registry';
import type { Branch } from '@shared/git';
import { makePtySessionId } from '@shared/ptySessionId';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { createTask } from '@main/core/tasks/operations/createTask';
import { getTasks } from '@main/core/tasks/operations/getTasks';
import { createTerminal } from '@main/core/terminals/createTerminal';
import { getTerminalsForTask } from '@main/core/terminals/getTerminalsForTask';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import type { DevServerTracker } from '../dev-server-tracker';
import { HttpError, type CallerContext } from '../http-server';

// ---------- Wire schemas ----------

export const TaskCreateBodySchema = z
  .object({
    projectId: z.string().optional(),
    name: z.string().min(1),
    sourceBranch: z.string().optional(),
    taskBranch: z.string().optional(),
    initialPrompt: z.string().optional(),
    providerId: z.string().optional(),
    // v1: only new-branch worktree strategy. Single-element enum so future
    // widening is explicit (z.literal here would mean 'wrong key' on extension).
    strategy: z.enum(['new-branch']).optional(),
  })
  .refine((v) => !v.initialPrompt || v.providerId, {
    message: 'initialPrompt requires providerId',
    path: ['initialPrompt'],
  });
export type TaskCreateBody = z.infer<typeof TaskCreateBodySchema>;

export const TerminalCreateBodySchema = z.object({
  initialCommand: z.string().optional(),
  name: z.string().optional(),
});
export type TerminalCreateBody = z.infer<typeof TerminalCreateBodySchema>;

export const TerminalSendBodySchema = z.object({
  text: z.string(),
  submit: z.boolean().optional(),
});
export type TerminalSendBody = z.infer<typeof TerminalSendBodySchema>;

export const TaskListQuerySchema = z.object({
  projectId: z.string().optional(),
  includeArchived: z.boolean().optional(),
});
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;

export const ProjectListQuerySchema = z.object({
  includeArchived: z.boolean().optional(),
});
export type ProjectListQuery = z.infer<typeof ProjectListQuerySchema>;

async function lookupProjectNames(projectIds: string[]): Promise<Map<string, string>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(inArray(projects.id, projectIds));
  return new Map(rows.map((r) => [r.id, r.name]));
}

interface TaskSummary {
  id: string;
  projectId: string;
  projectName?: string;
  name: string;
  status: string;
  taskBranch?: string;
  archivedAt?: string;
  lastInteractedAt?: string;
}

export async function handleTaskList(
  caller: CallerContext,
  query: TaskListQuery
): Promise<TaskSummary[]> {
  const projectId = query.projectId ?? caller.conversation.projectId;
  const tasks = await getTasks(projectId);
  const filtered = query.includeArchived ? tasks : tasks.filter((t) => !t.archivedAt);
  const projectNames = await lookupProjectNames(
    Array.from(new Set(filtered.map((t) => t.projectId)))
  );
  return filtered.map((t) => ({
    id: t.id,
    projectId: t.projectId,
    projectName: projectNames.get(t.projectId),
    name: t.name,
    status: t.status,
    taskBranch: t.taskBranch,
    archivedAt: t.archivedAt,
    lastInteractedAt: t.lastInteractedAt,
  }));
}

export async function handleTaskCreate(
  caller: CallerContext,
  body: TaskCreateBody
): Promise<{
  taskId: string;
  taskName: string;
  taskBranch?: string;
  projectId: string;
  conversationId?: string;
}> {
  const projectId = body.projectId ?? caller.conversation.projectId;

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new HttpError(404, 'project not found');

  const sourceBranchName = body.sourceBranch ?? project.baseRef;
  if (!sourceBranchName) {
    throw new HttpError(400, 'sourceBranch required: project has no baseRef configured');
  }
  const sourceBranch: Branch = { type: 'local', branch: sourceBranchName };

  let providerId: AgentProviderId | undefined;
  if (body.providerId) {
    if (!isValidProviderId(body.providerId)) throw new HttpError(400, 'invalid providerId');
    providerId = body.providerId;
  }

  const taskId = randomUUID();
  const conversationId = providerId ? randomUUID() : undefined;

  const result = await createTask({
    id: taskId,
    projectId,
    name: body.name,
    sourceBranch,
    strategy: {
      kind: 'new-branch',
      taskBranch: body.taskBranch ?? body.name,
    },
    initialConversation:
      providerId && conversationId
        ? {
            id: conversationId,
            projectId,
            taskId,
            provider: providerId,
            title: body.name,
            initialPrompt: body.initialPrompt,
            isInitialConversation: true,
          }
        : undefined,
  });

  if (!result.success) {
    throw new HttpError(500, `task creation failed: ${result.error.type}`);
  }

  return {
    taskId: result.data.task.id,
    taskName: result.data.task.name,
    taskBranch: result.data.task.taskBranch,
    projectId: result.data.task.projectId,
    conversationId,
  };
}

interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  baseRef: string | null;
  archived: boolean;
}

export async function handleProjectList(
  _caller: CallerContext,
  query: ProjectListQuery
): Promise<ProjectSummary[]> {
  const rows = await db.select().from(projects);
  const filtered = query.includeArchived ? rows : rows.filter((p) => !p.archived);
  return filtered.map((p) => ({
    id: p.id,
    name: p.name,
    path: p.path,
    baseRef: p.baseRef,
    archived: p.archived,
  }));
}

interface TerminalSummary {
  id: string;
  taskId: string;
  projectId: string;
  name: string;
}

export async function handleTerminalList(caller: CallerContext): Promise<TerminalSummary[]> {
  const list = await getTerminalsForTask(caller.conversation.projectId, caller.conversation.taskId);
  return list.map((t) => ({
    id: t.id,
    taskId: t.taskId,
    projectId: t.projectId,
    name: t.name,
  }));
}

export async function handleTerminalSend(
  caller: CallerContext,
  terminalId: string,
  body: TerminalSendBody
): Promise<{ ok: true }> {
  const sessionId = makePtySessionId(
    caller.conversation.projectId,
    caller.conversation.taskId,
    terminalId
  );
  const pty = ptySessionRegistry.get(sessionId);
  if (!pty) throw new HttpError(410, 'terminal not running');

  pty.write(body.text);
  if (body.submit) pty.write('\n');
  return { ok: true };
}

export async function handleTerminalCreate(
  caller: CallerContext,
  body: TerminalCreateBody
): Promise<{ terminalId: string }> {
  const id = randomUUID();
  const terminal = await createTerminal({
    id,
    projectId: caller.conversation.projectId,
    taskId: caller.conversation.taskId,
    name: body.name ?? 'Agent terminal',
  });

  // createTerminal awaits spawnTerminal which registers the session
  // synchronously before returning, so the PTY is in the registry by the
  // time we reach here. PTY buffers writes until the shell is ready, so
  // no delay is required.
  if (body.initialCommand) {
    const sessionId = makePtySessionId(
      caller.conversation.projectId,
      caller.conversation.taskId,
      terminal.id
    );
    const pty = ptySessionRegistry.get(sessionId);
    if (pty) {
      pty.write(body.initialCommand);
      pty.write('\n');
    }
  }

  return { terminalId: terminal.id };
}

export function handleWorkspaceDevServers(
  caller: CallerContext,
  tracker: DevServerTracker
): {
  servers: Array<{ terminalId: string; url: string; detectedAt: number }>;
} {
  const entries = tracker.listForTask(caller.conversation.taskId);
  return {
    servers: entries.map((e) => ({
      terminalId: e.terminalId,
      url: e.url,
      detectedAt: e.detectedAt,
    })),
  };
}
