import { asc, eq, sql } from 'drizzle-orm';
import { isValidProviderId, type ProviderId } from '@shared/providers/registry';
import { makePtySessionId } from '@shared/ptySessionId';
import { workspaceManager } from '@main/core/workspaces/workspace-manager';
import { createRPCController } from '../../../shared/ipc/rpc';
import { db } from '../../db/client';
import { conversations, projects, tasks, type ConversationRow } from '../../db/schema';
import { log } from '../../lib/logger';
import { err, ok } from '../../lib/result';
import { buildAgentCommand } from '../pty/build-agent-command';
import { ptySessionRegistry } from '../pty/pty-session-registry';
import type { Conversation } from './core';

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
        const providerId: ProviderId | null = isValidProviderId(provider) ? provider : null;
        const { command, args } = providerId
          ? buildAgentCommand({
              providerId,
              autoApprove: autoApprove ?? false,
              resume: resume ?? false,
              initialPrompt,
              sessionId: agentSessionId,
            })
          : { command: provider, args: [] };

        const provider_ = workspaceManager.getProvider(project.id);
        if (!provider_) {
          log.warn('conversationController.createConversation: no provider for project', {
            projectId: project.id,
          });
        } else {
          provider_
            .provision({ task, projectPath: project.path, conversations: [], terminals: [] })
            .then((env) =>
              env.agentProvider.startSession({
                projectId: project.id,
                conversationId,
                taskId,
                providerId: providerId ?? 'codex',
                command,
                args,
                cwd: task.path,
                projectPath: project.path,
                agentSessionId,
                autoApprove: autoApprove ?? false,
                resume: resume ?? false,
              })
            )
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
    }

    return ok(mapConversationRow(row));
  },

  deleteConversation: async (id: string) => {
    const [row] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
    if (!row) return err({ type: 'not_found' as const });

    // Look up project to find the right provider.
    const [task] = await db.select().from(tasks).where(eq(tasks.id, row.taskId)).limit(1);
    if (task) {
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, task.projectId))
        .limit(1);
      if (project) {
        const provider = workspaceManager.getProvider(project.id);
        const env = provider?.getEnvironment(task.id);
        if (env) {
          env.agentProvider.stopSession(id);
        } else {
          // Fall back: kill by deterministic session ID if the provider hasn't provisioned yet.
          const sessionId = makePtySessionId(project.id, task.id, id);
          const pty = ptySessionRegistry.get(sessionId);
          if (pty) {
            try {
              pty.kill();
            } catch {}
            ptySessionRegistry.unregister(sessionId);
          }
        }
      }
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

    // If a live session already exists, reuse it.
    const sessionId = makePtySessionId(project.id, task.id, conversationId);
    if (ptySessionRegistry.get(sessionId)) {
      return ok({ reused: true });
    }

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

    const envProvider = workspaceManager.getProvider(project.id);
    if (!envProvider) {
      log.warn('conversations.startSession: no provider for project', { projectId: project.id });
      return err({ type: 'provider_not_found' as const });
    }

    envProvider
      .provision({ task, projectPath: project.path, conversations: [], terminals: [] })
      .then((env) =>
        env.agentProvider.startSession({
          projectId: project.id,
          conversationId,
          taskId: task.id,
          providerId: providerId ?? 'codex',
          command,
          args,
          cwd: task.path,
          projectPath: project.path,
          agentSessionId: conversationRow.agentSessionId ?? undefined,
          autoApprove,
          resume,
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
