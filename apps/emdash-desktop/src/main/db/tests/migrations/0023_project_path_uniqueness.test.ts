import { openFixture } from '@tooling/utils/db';
import { afterEach, describe, expect, it } from 'vitest';

describe('0023 project path uniqueness', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  afterEach(() => {
    fixture?.close();
  });

  it('replaces the global path index with host-scoped partial indexes', async () => {
    fixture = await openFixture('pre-0023');

    const indexes = fixture.sqlite.prepare(`PRAGMA index_list('projects')`).all() as {
      name: string;
      partial: number;
      unique: number;
    }[];

    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'idx_projects_local_path',
          partial: 1,
          unique: 1,
        }),
        expect.objectContaining({
          name: 'idx_projects_remote_path',
          partial: 1,
          unique: 1,
        }),
      ])
    );
    expect(indexes.map(({ name }) => name)).not.toContain('idx_projects_path');
  });

  it('allows the same path on different hosts while enforcing uniqueness per host', async () => {
    fixture = await openFixture('pre-0023');

    const insertConnection = fixture.sqlite.prepare(
      `INSERT INTO ssh_connections (id, name, host, username) VALUES (?, ?, ?, 'test')`
    );
    insertConnection.run('connection-a', 'Connection A', 'host-a');
    insertConnection.run('connection-b', 'Connection B', 'host-b');

    const insertProject = fixture.sqlite.prepare(
      `INSERT INTO projects (id, name, path, workspace_provider, ssh_connection_id)
       VALUES (?, ?, '/srv/repos/emdash', ?, ?)`
    );
    insertProject.run('local-project', 'Local', 'local', null);
    insertProject.run('remote-project-a', 'Remote A', 'ssh', 'connection-a');
    insertProject.run('remote-project-b', 'Remote B', 'ssh', 'connection-b');

    expect(() => insertProject.run('duplicate-local', 'Duplicate local', 'local', null)).toThrow(
      /UNIQUE constraint failed/
    );
    expect(() =>
      insertProject.run('duplicate-remote', 'Duplicate remote', 'ssh', 'connection-a')
    ).toThrow(/UNIQUE constraint failed/);
  });

  it('allows a path to be re-added after its project is tombstoned', async () => {
    fixture = await openFixture('pre-0023');

    const insertProject = fixture.sqlite.prepare(
      `INSERT INTO projects (id, name, path, workspace_provider)
       VALUES (?, ?, '/repos/reusable', 'local')`
    );
    insertProject.run('project-before-delete', 'Before delete');
    fixture.sqlite
      .prepare(`UPDATE projects SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run('project-before-delete');

    expect(() => insertProject.run('project-after-delete', 'After delete')).not.toThrow();
  });

  it('does not move an orphaned SSH project into the local uniqueness partition', async () => {
    fixture = await openFixture('pre-0023');

    fixture.sqlite
      .prepare(
        `INSERT INTO ssh_connections (id, name, host, username)
         VALUES ('connection-to-delete', 'Connection', 'host', 'test')`
      )
      .run();
    fixture.sqlite
      .prepare(
        `INSERT INTO projects (id, name, path, workspace_provider)
         VALUES ('local-same-path', 'Local', '/repos/shared', 'local')`
      )
      .run();
    fixture.sqlite
      .prepare(
        `INSERT INTO projects (id, name, path, workspace_provider, ssh_connection_id)
         VALUES ('remote-same-path', 'Remote', '/repos/shared', 'ssh', 'connection-to-delete')`
      )
      .run();

    expect(() =>
      fixture.sqlite.prepare(`DELETE FROM ssh_connections WHERE id = 'connection-to-delete'`).run()
    ).not.toThrow();
    const orphaned = fixture.sqlite
      .prepare(`SELECT workspace_provider, ssh_connection_id FROM projects WHERE id = ?`)
      .get('remote-same-path');
    expect(orphaned).toEqual({ workspace_provider: 'ssh', ssh_connection_id: null });
  });
});
