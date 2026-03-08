import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { projects, tasks } from '../../db/schema';
import { log } from '../../lib/logger';
import { spawnLocalPty } from '../../pty/local-pty';
import { buildSessionEnv } from '../../pty/pty-env';
import { environmentProviderManager } from '../../workspaces/provider-manager';
import { ensureProjectSettings } from '../projects/ensureProjectSettings';
import type { TaskMetadata } from './core';

export async function archiveTask(id: string): Promise<void> {
  // Tear down all PTY sessions for this task across all providers.
  await environmentProviderManager.teardownTask(id);

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
    const env = buildSessionEnv('lifecycle');
    const shell = process.env.SHELL ?? '/bin/sh';
    const result = spawnLocalPty({
      id: crypto.randomUUID(),
      command: shell,
      args: ['-c', teardownScript],
      cwd: row.path,
      env,
      cols: 80,
      rows: 24,
    });
    if (!result.success) {
      log.error('archiveTask: teardown script spawn failed', { taskId: id, error: result.error });
    } else {
      result.data.onExit(({ exitCode }) => {
        log.info('archiveTask: teardown script finished', { taskId: id, exitCode });
      });
    }
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
