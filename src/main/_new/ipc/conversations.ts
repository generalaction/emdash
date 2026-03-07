import { db } from '../db/client';
import { conversations, tasks, projects } from '../db/schema';
import { eq, asc, sql } from 'drizzle-orm';
import { createRPCController } from '../../../shared/ipc/rpc';
import { ok, err } from '../../lib/result';
import { ptySessionManager } from '../pty/session/core';
import { taskResourceManager } from '../environment/task-resource-manager';
import { buildAgentCommand } from '../pty/build-agent-command';
import { isValidProviderId, type ProviderId } from '@shared/providers/registry';
import { log } from '../lib/logger';
import type { Conversation } from '../core/conversations';
import type { ConversationRow } from '../db/schema';

function mapConversationRow(row: ConversationRow): Conversation {
  return {
    id: row.id,
    taskId: row.taskId,
    title: row.title,
    provider: row.provider ?? null,
    isMain: row.isMain === 1,
    displayOrder: row.displayOrder,
    agentSessionId: row.agentSessionId ?? null,
    type: (row.type as 'agent' | 'shell') ?? 'agent',
    metadata: row.metadata ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type CreateConversationParams = {
  taskId: string;
  provider: string;
  title?: string;
  type?: 'agent' | 'shell';
  /** Pass the provider's auto-approve flag when spawning. */
  autoApprove?: boolean;
  /** Append the provider's resume flag (continue existing session). */
  resume?: boolean;
  /** Initial prompt text passed via CLI flag or positional argument. */
  initialPrompt?: string;
};

export const conversationController = createRPCController({
  getConversations: async (taskId: string) => {
    const rows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.taskId, taskId))
      .orderBy(asc(conversations.displayOrder));
    return rows.map(mapConversationRow);
  },

  createConversation: async (params: CreateConversationParams) => {
    const { taskId, provider, title, type = 'agent', autoApprove, resume, initialPrompt } = params;

    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!task) return err({ type: 'task_not_found' as const });

    const maxOrderResult = await db
      .select({ maxOrder: sql<number>`MAX(${conversations.displayOrder})` })
      .from(conversations)
      .where(eq(conversations.taskId, taskId));
    const nextOrder = (maxOrderResult[0]?.maxOrder ?? -1) + 1;

    const conversationId = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const conversationTitle = title ?? `${provider} conversation`;

    // For providers with sessionIdFlag (e.g. Claude --session-id), generate a
    // stable UUID so Claude can maintain conversation history across restarts.
    const agentSessionId = crypto.randomUUID();

    const [row] = await db
      .insert(conversations)
      .values({
        id: conversationId,
        taskId,
        title: conversationTitle,
        provider,
        isMain: 0,
        isActive: 0,
        displayOrder: nextOrder,
        type,
        agentSessionId,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .returning();

    if (type === 'agent') {
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, task.projectId))
        .limit(1);

      if (project) {
        taskResourceManager
          .getOrProvision(project, task)
          .then((env) => {
            const providerId = isValidProviderId(provider) ? provider : null;

            // Build the CLI command from the provider definition when available,
            // otherwise fall back to the bare provider string as the command.
            const { command, args } = providerId
              ? buildAgentCommand({
                  providerId,
                  autoApprove: autoApprove ?? false,
                  resume: resume ?? false,
                  initialPrompt,
                  sessionId: agentSessionId,
                })
              : { command: provider, args: [] };

            return ptySessionManager.createSession({
              // conversationId is the PTY session ID so the renderer can subscribe
              // to ptyDataChannel / ptyExitChannel with topic = conversationId.
              id: conversationId,
              type: 'agent',
              config: {
                taskId,
                conversationId,
                providerId: providerId ?? 'codex', // safe fallback for classifier
                command,
                args,
                cwd: task.path,
                projectPath: project.path,
                sessionId: agentSessionId,
                autoApprove: autoApprove ?? false,
                resume: resume ?? false,
              },
              transport:
                env.transport === 'ssh2' && env.connectionId
                  ? { type: 'ssh2', connectionId: env.connectionId }
                  : { type: 'local' },
            });
          })
          .then((result) => {
            if (!result.success) {
              log.error('conversationController: failed to spawn agent PTY', {
                conversationId,
                error: result.error,
              });
            }
          })
          .catch((e) =>
            log.error('conversationController: unexpected PTY spawn error', {
              conversationId,
              error: String(e),
            })
          );
      }
    }

    return ok(mapConversationRow(row));
  },

  deleteConversation: async (id: string) => {
    const [row] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);

    if (!row) return err({ type: 'not_found' as const });

    // conversationId == PTY session ID in the new system; also sweep any
    // sessions that might still use the legacy task-scoped lookup.
    ptySessionManager.destroySession(id);
    const remainingSessions = ptySessionManager.getSessionsForTask(row.taskId).filter((s) => {
      const cfg = s.config as { conversationId?: string };
      return cfg.conversationId === id;
    });
    for (const session of remainingSessions) {
      ptySessionManager.destroySession(session.id);
    }

    await db.delete(conversations).where(eq(conversations.id, id));
    return ok();
  },

  setActiveConversation: async (taskId: string, conversationId: string) => {
    const [row] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

    if (!row?.taskId || row.taskId !== taskId) return err({ type: 'not_found' as const });

    // Active conversation is tracked in the renderer (localStorage), but we
    // store it in metadata as a convenience for main-process consumers.
    const meta = row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {};
    meta.active = true;

    await db
      .update(conversations)
      .set({ metadata: JSON.stringify(meta), updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(conversations.id, conversationId));

    return ok();
  },

  reorderConversations: async (taskId: string, orderedIds: string[]) => {
    await Promise.all(
      orderedIds.map((id, index) =>
        db
          .update(conversations)
          .set({ displayOrder: index, updatedAt: sql`CURRENT_TIMESTAMP` })
          .where(eq(conversations.id, id))
      )
    );
    return ok();
  },

  startSession: async (params: {
    conversationId: string;
    resume?: boolean;
    autoApprove?: boolean;
  }) => {
    const { conversationId, resume = false, autoApprove = false } = params;

    // If a live session already exists for this conversation, reuse it.
    if (ptySessionManager.getSession(conversationId)) {
      return ok({ reused: true });
    }

    const [conversationRow] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    if (!conversationRow) return err({ type: 'not_found' as const });

    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, conversationRow.taskId))
      .limit(1);
    if (!task) return err({ type: 'task_not_found' as const });

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, task.projectId))
      .limit(1);
    if (!project) return err({ type: 'project_not_found' as const });

    const rawProvider = conversationRow.provider ?? '';
    const providerId: ProviderId | null = isValidProviderId(rawProvider) ? rawProvider : null;

    const { command, args } = providerId
      ? buildAgentCommand({
          providerId,
          autoApprove,
          resume,
          sessionId: conversationRow.agentSessionId ?? undefined,
        })
      : { command: conversationRow.provider ?? 'sh', args: [] };

    taskResourceManager
      .getOrProvision(project, task)
      .then((env) =>
        ptySessionManager.createSession({
          id: conversationId,
          type: 'agent',
          config: {
            taskId: task.id,
            conversationId,
            providerId: providerId ?? 'codex',
            command,
            args,
            cwd: task.path,
            projectPath: project.path,
            sessionId: conversationRow.agentSessionId ?? undefined,
            autoApprove,
            resume,
          },
          transport:
            env.transport === 'ssh2' && env.connectionId
              ? { type: 'ssh2', connectionId: env.connectionId }
              : { type: 'local' },
        })
      )
      .then((result) => {
        if (!result.success) {
          log.error('conversations.startSession: failed to spawn agent PTY', {
            conversationId,
            error: result.error,
          });
        }
      })
      .catch((e) =>
        log.error('conversations.startSession: unexpected PTY spawn error', {
          conversationId,
          error: String(e),
        })
      );

    return ok({ reused: false });
  },
});
