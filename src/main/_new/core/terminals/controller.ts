import { db } from '../../db/client';
import { terminals, tasks, projects } from '../../db/schema';
import { count, eq, sql } from 'drizzle-orm';
import { createRPCController } from '../../../../shared/ipc/rpc';
import { ok, err } from '../../../lib/result';
import { ptySessionManager } from '../../pty/session/core';
import { taskResourceManager } from '../../environment/task-resource-manager';
import { log } from '../../lib/logger';
import type { Terminal } from './core';
import type { ProjectRow, TaskRow } from '../../db/schema';

function mapTerminalRow(row: {
  id: string;
  taskId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}): Terminal {
  return { id: row.id, taskId: row.taskId, name: row.name };
}

/**
 * Terminal IDs that have been explicitly deleted.
 * Used to suppress the auto-respawn on the final exit after a kill.
 */
const deletedTerminals = new Set<string>();

/**
 * Spawn (or re-spawn) a general PTY session for a terminal row.
 * Uses terminalId as the PTY session ID so the renderer can subscribe
 * immediately after createTerminal returns.
 * Recursively re-schedules itself on exit unless the terminal was deleted.
 */
function spawnTerminalSession(
  terminalId: string,
  taskId: string,
  project: ProjectRow,
  task: TaskRow
): void {
  taskResourceManager
    .getOrProvision(project, task)
    .then((env) =>
      ptySessionManager.createSession({
        id: terminalId,
        type: 'general',
        config: {
          taskId,
          cwd: task.path,
          projectPath: project.path,
        },
        transport:
          env.transport === 'ssh2' && env.connectionId
            ? { type: 'ssh2', connectionId: env.connectionId }
            : { type: 'local' },
      })
    )
    .then((result) => {
      if (!result.success) {
        log.error('terminalsController: failed to spawn terminal PTY', {
          terminalId,
          error: result.error,
        });
        return;
      }

      result.data.pty.onExit(() => {
        if (!deletedTerminals.has(terminalId)) {
          setTimeout(() => spawnTerminalSession(terminalId, taskId, project, task), 500);
        }
      });
    })
    .catch((e) =>
      log.error('terminalsController: unexpected PTY spawn error', {
        terminalId,
        error: String(e),
      })
    );
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
      spawnTerminalSession(terminalId, taskId, project, task);
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

    // Mark as deleted first so the onExit handler does not re-spawn
    deletedTerminals.add(terminalId);
    ptySessionManager.destroySession(terminalId);

    await db.delete(terminals).where(eq(terminals.id, terminalId));

    // Clean up the set after a delay to prevent unbounded growth
    setTimeout(() => deletedTerminals.delete(terminalId), 10_000);

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
