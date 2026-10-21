import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceRegistry } from '@core/features/workspaces/api/node/registry';
import { projects } from '@core/services/app-db/node/schema';
import { createWorkspaceIdentityService } from './workspace-identity-source';

describe('workspace identity database source', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fixture.close();
  });

  function registerDirectory(id: string, path: string): void {
    createWorkspaceRegistry(fixture.db).recordCreationIntent({
      id,
      kind: 'directory',
      type: 'local',
      location: 'local',
      path,
    });
    fixture.db
      .insert(projects)
      .values({
        id: `project-${id}`,
        name: id,
        repositoryWorkspaceId: id,
      })
      .run();
  }

  it('matches Windows path casing without a preceding id lookup', async () => {
    registerDirectory('windows', 'C:\\Repo');
    const service = createWorkspaceIdentityService({ db: fixture.db });

    expect(await service.findByPath('c:\\REPO', LOCAL_HOST_REF)).toEqual({
      workspaceId: 'windows',
      projectId: 'project-windows',
      host: LOCAL_HOST_REF,
      path: 'C:\\Repo',
    });
    expect(await service.findByPath('C:\\Other', LOCAL_HOST_REF)).toBeNull();
  });

  it('observes moved and untracked workspaces through all lookup methods', async () => {
    registerDirectory('directory', '/old/path');
    const service = createWorkspaceIdentityService({ db: fixture.db });
    await service.resolve('directory');
    await service.resolveProject('project-directory');
    await service.findByPath('/old/path', LOCAL_HOST_REF);

    const registry = createWorkspaceRegistry(fixture.db);
    registry.refresh('directory', { path: '/new/path' });

    expect(await service.resolve('directory')).toMatchObject({ path: '/new/path' });
    expect(await service.resolveProject('project-directory')).toMatchObject({ path: '/new/path' });
    expect(await service.findByPath('/old/path', LOCAL_HOST_REF)).toBeNull();
    expect(await service.findByPath('/new/path', LOCAL_HOST_REF)).toMatchObject({
      workspaceId: 'directory',
    });

    registry.untrack(['directory'], new Date().toISOString());

    expect(await service.resolve('directory')).toBeNull();
    expect(await service.resolveProject('project-directory')).toBeNull();
    expect(await service.findByPath('/new/path', LOCAL_HOST_REF)).toBeNull();
  });

  it('keeps path lookup query counts constant as unrelated workspaces are added', async () => {
    registerDirectory('target', '/target');
    const prepare = vi.spyOn(fixture.sqlite, 'prepare');
    const resolveTarget = () =>
      createWorkspaceIdentityService({ db: fixture.db }).findByPath('/target', LOCAL_HOST_REF);

    expect(await resolveTarget()).toMatchObject({ workspaceId: 'target' });
    const baselineQueries = prepare.mock.calls.length;
    const registry = createWorkspaceRegistry(fixture.db);
    for (let index = 0; index < 499; index++) {
      registry.recordCreationIntent({
        id: `unrelated-${index}`,
        kind: 'directory',
        type: 'local',
        location: 'local',
        path: `/unrelated/${index}`,
      });
    }
    prepare.mockClear();

    expect(await resolveTarget()).toMatchObject({ workspaceId: 'target' });
    expect(prepare).toHaveBeenCalledTimes(baselineQueries);
  });
});
