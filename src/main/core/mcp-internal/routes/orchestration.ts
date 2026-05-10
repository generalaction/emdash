import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
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

interface TaskSummary {
  id: string;
  projectId: string;
  name: string;
  status: string;
  taskBranch?: string;
  archivedAt?: string;
  lastInteractedAt?: string;
}

export async function handleTaskList(
  caller: CallerContext,
  query: { projectId?: string; includeArchived?: boolean }
): Promise<TaskSummary[]> {
  const projectId = query.projectId ?? caller.conversation.projectId;
  const tasks = await getTasks(projectId);
  const filtered = query.includeArchived ? tasks : tasks.filter((t) => !t.archivedAt);
  return filtered.map((t) => ({
    id: t.id,
    projectId: t.projectId,
    name: t.name,
    status: t.status,
    taskBranch: t.taskBranch,
    archivedAt: t.archivedAt,
    lastInteractedAt: t.lastInteractedAt,
  }));
}

interface TaskCreateBody {
  projectId?: string;
  name: string;
  /** Branch name to fork from. Defaults to project's baseRef. */
  sourceBranch?: string;
  /** Custom name for the new task branch. Optional; auto-generated when omitted. */
  taskBranch?: string;
  initialPrompt?: string;
  providerId?: string;
}

export async function handleTaskCreate(
  caller: CallerContext,
  body: TaskCreateBody
): Promise<{ taskId: string; conversationId?: string }> {
  if (!body.name || typeof body.name !== 'string') {
    throw new HttpError(400, 'name is required');
  }
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

  return { taskId: result.data.task.id, conversationId };
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
  body: { text: string; submit?: boolean }
): Promise<{ ok: true }> {
  if (typeof body.text !== 'string') throw new HttpError(400, 'text must be string');

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

interface TerminalCreateBody {
  initialCommand?: string;
  name?: string;
  /** Currently a no-op — drawer focus IPC is not wired. See spec §13a. */
  focus?: boolean;
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

  if (body.initialCommand) {
    // Wait briefly for the PTY to register, then type + submit.
    setTimeout(() => {
      const sessionId = makePtySessionId(
        caller.conversation.projectId,
        caller.conversation.taskId,
        terminal.id
      );
      const pty = ptySessionRegistry.get(sessionId);
      if (pty) {
        pty.write(body.initialCommand!);
        pty.write('\n');
      }
    }, 250);
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
