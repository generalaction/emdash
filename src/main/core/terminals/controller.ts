import { count, eq, sql } from 'drizzle-orm';
import { createRPCController } from '@shared/ipc/rpc';
import { workspaceManager } from '@main/core/workspaces/workspace-manager';
import { db } from '@main/db/client';
import { projects, tasks, terminals } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { err, ok } from '@main/lib/result';
import type { Terminal } from './core';

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

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, task.projectId))
      .limit(1);

    if (project) {
      const provider = workspaceManager.getProvider(project.id);
      if (!provider) {
        log.warn('terminalsController.createTerminal: no provider for project', {
          projectId: project.id,
        });
      } else {
        // Ensure task environment is provisioned, then spawn the terminal.
        provider
          .provision({
            task,
            projectPath: project.path,
            conversations: [],
            terminals: [],
          })
          .then((env) =>
            env.terminalProvider.spawnTerminal({
              projectId: project.id,
              terminalId,
              taskId,
              cwd: task.path,
              projectPath: project.path,
            })
          )
          .then((result) => {
            if (!result.success) {
              log.error('terminalsController: failed to spawn terminal PTY', {
                terminalId,
                error: result.error,
              });
            }
          })
          .catch((e) =>
            log.error('terminalsController: unexpected PTY spawn error', {
              terminalId,
              error: String(e),
            })
          );
      }
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
        const provider = workspaceManager.getProvider(project.id);
        const env = provider?.getEnvironment(task.id);
        if (env) {
          env.terminalProvider.killTerminal(terminalId);
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
