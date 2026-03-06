import { db } from '@/db/client';
import { projects, tasks } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';
import { cleanupTaskPtys } from '@/services/ptyCleanup';
import type { TaskMetadata } from './core';
import { ensureProjectSettings } from '../projects/ensureProjectSettings';
import { spawnLocalPty } from '@/pty/local-pty';
import { buildAgentEnv } from '@/pty/env';
import { ptyManager } from '@/pty/pty-manager';

export async function archiveTask(id: string): Promise<void> {
  await cleanupTaskPtys(id);

  const [row] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!row) return;

  const [project] = await db.select().from(projects).where(eq(projects.id, row.projectId)).limit(1);
  if (!project) return;

  const meta: TaskMetadata = row.metadata ? JSON.parse(row.metadata) : {};
  meta.lifecycleStatus = 'archived';

  const projectSettings = ensureProjectSettings(project.path);
  if (!projectSettings.success) return;
  const teardownScript = projectSettings.data.scripts?.teardown;
  if (!teardownScript) return;

  const result = spawnLocalPty({
    id: `lifecycle-teardown-${row.id}`,
    command: process.env.SHELL ?? '/bin/sh',
    args: ['-c', teardownScript],
    cwd: row.path,
    env: buildAgentEnv(),
    cols: 80,
    rows: 24,
  });

  if (result.success) {
    ptyManager.addPty(`lifecycle-teardown-${row.id}`, result.data);
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
