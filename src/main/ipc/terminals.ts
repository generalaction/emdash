import { count, eq, sql } from 'drizzle-orm';
import { createRPCController } from '../../shared/ipc/rpc';
import type { Terminal } from '../core/terminals/core';
import { db } from '../db/client';
import { projects, tasks, terminals } from '../db/schema';
import { log } from '../lib/logger';
import { err, ok } from '../lib/result';
import { ptySessionRegistry } from '../pty/pty-session-registry';
import { environmentProviderManager } from '../workspaces/provider-manager';

function mapTerminalRow(row: {
  id: string;
  taskId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}): Terminal {
  return { id: row.id, taskId: row.taskId, name: row.name };
}

export const terminalsController = createRPCController({
  createTerminal: async (taskId: string, name?: string) => {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!task) return err({ type: 'task_not_found' as const });

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, task.projectId))
      .limit(1);
    if (!project) return err({ type: 'task_not_found' as const });

    const terminalId = crypto.randomUUID();

    const resolvedName =
      name ??
      `Terminal ${
        (await db
          .select({ count: count() })
          .from(terminals)
          .where(eq(terminals.taskId, taskId))
          .then((r) => r[0]?.count ?? 0)) + 1
      }`;

    await db.insert(terminals).values({
      id: terminalId,
      taskId,
      name: resolvedName,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    });

    const provider = environmentProviderManager.getProvider(project.id);
    const env = provider?.getEnvironment(task.id);

    if (env) {
      env.terminalProvider
        .spawnTerminal({
          projectId: project.id,
          terminalId,
          taskId,
          cwd: task.path,
          projectPath: project.path,
        })
        .catch((e) => {
          log.error('terminalsController: failed to spawn terminal', {
            terminalId,
            error: String(e),
          });
        });
    } else {
      log.warn('terminalsController: no environment provisioned for task', {
        taskId,
        projectId: project.id,
      });
    }

    return ok({ terminalId });
  },

  getTerminals: async (taskId: string) => {
    const rows = await db.select().from(terminals).where(eq(terminals.taskId, taskId));
    return rows.map(mapTerminalRow);
  },

  deleteTerminal: async (terminalId: string) => {
    const [row] = await db.select().from(terminals).where(eq(terminals.id, terminalId)).limit(1);
    if (!row) return err({ type: 'not_found' as const });

    const [task] = await db.select().from(tasks).where(eq(tasks.id, row.taskId)).limit(1);

    if (task) {
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, task.projectId))
        .limit(1);

      if (project) {
        const env = environmentProviderManager.getProvider(project.id)?.getEnvironment(task.id);
        if (env) {
          env.terminalProvider.killTerminal(terminalId);
        } else {
          // Fallback: kill by session ID directly if environment isn't provisioned.
          const sessionId = `${project.id}:${task.id}:${terminalId}`;
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

    await db.delete(terminals).where(eq(terminals.id, terminalId));
    return ok();
  },

  renameTerminal: async (terminalId: string, name: string) => {
    const [row] = await db.select().from(terminals).where(eq(terminals.id, terminalId)).limit(1);
    if (!row) return err({ type: 'not_found' as const });

    await db
      .update(terminals)
      .set({ name, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(terminals.id, terminalId));

    return ok();
  },
});
