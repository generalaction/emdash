import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectEvents } from '@core/features/projects/api/node/project-events';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import { projects } from '@core/services/app-db/node/schema';
import { renameProject } from './renameProject';

describe('renameProject', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');
    await fixture.db.insert(projects).values([
      { id: 'project', name: 'Old name', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'other', name: 'Other', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
  });

  afterEach(() => {
    fixture.close();
    vi.restoreAllMocks();
  });

  it('stores the trimmed name, bumps updatedAt, pokes the list, and emits project:renamed', async () => {
    const poke = vi.spyOn(appDbPokes.projects, 'poke');
    const emit = vi.spyOn(projectEvents, '_emit');

    await renameProject(fixture.db, 'project', '  New name  ');

    const [row] = await fixture.db.select().from(projects).where(eq(projects.id, 'project'));
    expect(row?.name).toBe('New name');
    expect(row?.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
    expect(poke).toHaveBeenCalledWith({ projectId: 'project' });
    expect(emit).toHaveBeenCalledWith('project:renamed', 'project', 'New name');

    const [other] = await fixture.db.select().from(projects).where(eq(projects.id, 'other'));
    expect(other?.name).toBe('Other');
  });

  it('rejects an empty name without touching the row', async () => {
    const poke = vi.spyOn(appDbPokes.projects, 'poke');
    const emit = vi.spyOn(projectEvents, '_emit');

    await expect(renameProject(fixture.db, 'project', '   ')).rejects.toThrow(
      'Project name cannot be empty'
    );

    const [row] = await fixture.db.select().from(projects).where(eq(projects.id, 'project'));
    expect(row?.name).toBe('Old name');
    expect(poke).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('fails for an unknown or deleted project', async () => {
    await fixture.db
      .update(projects)
      .set({ deletedAt: '2026-01-02T00:00:00.000Z' })
      .where(eq(projects.id, 'other'));

    await expect(renameProject(fixture.db, 'missing', 'Name')).rejects.toThrow(
      'Project missing not found'
    );
    await expect(renameProject(fixture.db, 'other', 'Name')).rejects.toThrow(
      'Project other not found'
    );
  });
});
