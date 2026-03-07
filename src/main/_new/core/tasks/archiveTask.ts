import { db } from '../../db/client';
import { projects, tasks } from '../../db/schema';
import { eq, sql } from 'drizzle-orm';
import type { TaskMetadata } from './core';
import { ensureProjectSettings } from '../projects/ensureProjectSettings';
import { taskResourceManager } from '../../environment/task-resource-manager';
import { ptySessionManager } from '../../pty/session/core';
import { log } from '../../lib/logger';

export async function archiveTask(id: string): Promise<void> {
  // Tear down all resources for this task (PTY sessions, environment, etc.)
  await taskResourceManager.teardown(id);

  const [row] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!row) return;

  const [project] = await db.select().from(projects).where(eq(projects.id, row.projectId)).limit(1);
  if (!project) return;

  const meta: TaskMetadata = row.metadata ? JSON.parse(row.metadata) : {};
  meta.lifecycleStatus = 'archived';

  const projectSettings = ensureProjectSettings(project.path);
  if (!projectSettings.success) {
    await db
      .update(tasks)
      .set({
        archivedAt: new Date().toISOString(),
        status: 'archived',
        metadata: JSON.stringify(meta),
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(tasks.id, id));
    return;
  }

  const teardownScript = projectSettings.data.scripts?.teardown?.trim();

  if (teardownScript) {
    // Re-provision environment for the teardown script.
    taskResourceManager
      .getOrProvision(project, { id, path: row.path })
      .then((env) => {
        return ptySessionManager.createSession({
          type: 'lifecycle',
          config: {
            taskId: id,
            phase: 'teardown',
            cwd: row.path,
            command: teardownScript,
            onExit: (exitCode) => {
              log.info('archiveTask: teardown script finished', { taskId: id, exitCode });
            },
          },
          transport:
            env.transport === 'ssh2' && env.connectionId
              ? { type: 'ssh2', connectionId: env.connectionId }
              : { type: 'local' },
        });
      })
      .catch((e) =>
        log.error('archiveTask: unexpected teardown script error', {
          taskId: id,
          error: String(e),
        })
      );
  }

  await db
    .update(tasks)
    .set({
      archivedAt: new Date().toISOString(),
      status: 'archived',
      metadata: JSON.stringify(meta),
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, id));
}
