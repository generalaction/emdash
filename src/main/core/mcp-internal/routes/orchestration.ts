import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { isValidProviderId, type AgentProviderId } from '@shared/agent-provider-registry';
import type { Branch } from '@shared/git';
import type {
  McpProjectListParams,
  McpProjectSummary,
  McpTaskCreateParams,
  McpTaskCreateResult,
  McpTaskListParams,
  McpTaskSummary,
  McpTerminalCreateParams,
  McpTerminalCreateResult,
  McpTerminalSendBody,
  McpTerminalSummary,
  McpWorkspaceDevServersResult,
} from '@shared/mcp/emdash-drive';
import { makePtySessionId } from '@shared/ptySessionId';
import type { CreateTaskError } from '@shared/tasks';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { createTask } from '@main/core/tasks/operations/createTask';
import { getTasks } from '@main/core/tasks/operations/getTasks';
import { createTerminal } from '@main/core/terminals/createTerminal';
import { getTerminalsForTask } from '@main/core/terminals/getTerminalsForTask';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import type { DevServerTracker } from '../dev-server-tracker';
import { HttpError, type CallerContext } from '../http-server';

/**
 * createTask result errors split into caller-actionable (4xx) vs
 * server-side (5xx). Caller-actionable: bad inputs, missing project,
 * branch already exists, repo unborn. Server-side: provision failures,
 * timeouts, worktree setup hardware errors.
 */
function createTaskErrorToHttp(error: CreateTaskError): HttpError {
  switch (error.type) {
    case 'project-not-found':
      return new HttpError(404, 'project not found');
    case 'branch-not-found':
      return new HttpError(400, `source branch not found: ${error.branch}`);
    case 'initial-commit-required':
      return new HttpError(409, `repository unborn: ${error.branch} has no commits`);
    case 'branch-create-failed':
      return new HttpError(409, `branch create failed: ${error.branch}`);
    case 'pr-fetch-failed':
      return new HttpError(502, `pr fetch failed from ${error.remote}`);
    case 'worktree-setup-failed':
    case 'provision-failed':
    case 'provision-timeout':
      return new HttpError(500, `task provisioning failed: ${error.type}`);
  }
}

async function lookupProjectNames(projectIds: string[]): Promise<Map<string, string>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(inArray(projects.id, projectIds));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function handleTaskList(
  caller: CallerContext,
  query: McpTaskListParams
): Promise<McpTaskSummary[]> {
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
  body: McpTaskCreateParams
): Promise<McpTaskCreateResult> {
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
    throw createTaskErrorToHttp(result.error);
  }

  return {
    taskId: result.data.task.id,
    taskName: result.data.task.name,
    taskBranch: result.data.task.taskBranch,
    projectId: result.data.task.projectId,
    conversationId,
  };
}

export async function handleProjectList(
  _caller: CallerContext,
  query: McpProjectListParams
): Promise<McpProjectSummary[]> {
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

export async function handleTerminalList(caller: CallerContext): Promise<McpTerminalSummary[]> {
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
  body: McpTerminalSendBody
): Promise<{ ok: true }> {
  if (typeof body.text !== 'string') throw new HttpError(400, 'text must be string');

  const sessionId = makePtySessionId(
    caller.conversation.projectId,
    caller.conversation.taskId,
    terminalId
  );
  const pty = ptySessionRegistry.get(sessionId);
  if (!pty) throw new HttpError(410, 'terminal not running');

  // Submit with \r (CR) — matches handleAgentSend. Cooked-mode shells
  // translate CR→LF via ICRNL, raw-mode TUIs (vim, claude, etc.) require
  // CR. \n would leave the command staged in TUIs.
  pty.write(body.text);
  if (body.submit) pty.write('\r');
  return { ok: true };
}

export async function handleTerminalCreate(
  caller: CallerContext,
  body: McpTerminalCreateParams
): Promise<McpTerminalCreateResult> {
  const id = randomUUID();
  const terminal = await createTerminal({
    id,
    projectId: caller.conversation.projectId,
    taskId: caller.conversation.taskId,
    name: body.name ?? 'Agent terminal',
  });

  // createTerminal awaits spawnTerminal, which registers the PTY before
  // resolving — no setTimeout/retry needed. Shells in cooked mode queue
  // input until the read loop picks it up, so writing before the prompt
  // prints is harmless. Submit with \r (CR) — see handleTerminalSend.
  if (body.initialCommand) {
    const sessionId = makePtySessionId(
      caller.conversation.projectId,
      caller.conversation.taskId,
      terminal.id
    );
    const pty = ptySessionRegistry.get(sessionId);
    if (!pty) throw new HttpError(500, 'pty failed to register after spawn');
    pty.write(body.initialCommand);
    pty.write('\r');
  }

  return { terminalId: terminal.id, name: terminal.name };
}

export function handleWorkspaceDevServers(
  caller: CallerContext,
  tracker: DevServerTracker
): McpWorkspaceDevServersResult {
  const entries = tracker.listForTask(caller.conversation.taskId);
  return {
    servers: entries.map((e) => ({
      terminalId: e.terminalId,
      url: e.url,
      detectedAt: e.detectedAt,
    })),
  };
}
