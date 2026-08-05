import { openFixture } from '@tooling/utils/db';
import { afterEach, describe, expect, it } from 'vitest';

// Starts from the pre-0019 baseline (last committed pre-migration snapshot); the
// forward-only runner in openFixture then applies 0019 and this 0020 migration on
// top, so the assertions below observe the state after 0020.
describe('0020 project path unique per connection migration', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  afterEach(() => {
    fixture?.close();
  });

  function projectIndexes() {
    return fixture.sqlite
      .prepare(`SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='projects'`)
      .all() as { name: string; sql: string | null }[];
  }

  function insertConnection(id: string, name: string) {
    fixture.sqlite
      .prepare(`INSERT INTO ssh_connections (id, name, host, username) VALUES (?, ?, ?, ?)`)
      .run(id, name, `${name}.example`, 'user');
  }

  function insertProject(id: string, path: string, sshConnectionId: string | null) {
    fixture.sqlite
      .prepare(
        `INSERT INTO projects (id, name, path, workspace_provider, ssh_connection_id)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, id, path, sshConnectionId ? 'ssh' : 'local', sshConnectionId);
  }

  it('drops the global unique path index', async () => {
    fixture = await openFixture('pre-0019');
    expect(projectIndexes().find((i) => i.name === 'idx_projects_path')).toBeUndefined();
  });

  it('creates a partial unique index for local project paths (ssh_connection_id is null)', async () => {
    fixture = await openFixture('pre-0019');
    const idx = projectIndexes().find((i) => i.name === 'idx_projects_local_path');
    expect(idx).toBeDefined();
    expect(idx!.sql).toMatch(/unique/i);
    expect(idx!.sql).toMatch(/where/i);
    expect(idx!.sql).toMatch(/is null/i);
  });

  it('creates a partial unique index scoped to (connection, path) for ssh projects', async () => {
    fixture = await openFixture('pre-0019');
    const idx = projectIndexes().find((i) => i.name === 'idx_projects_ssh_connection_path');
    expect(idx).toBeDefined();
    expect(idx!.sql).toMatch(/unique/i);
    expect(idx!.sql).toMatch(/ssh_connection_id/i);
    expect(idx!.sql).toMatch(/is not null/i);
  });

  it('allows the same path on two different SSH connections (the #2731 bug)', async () => {
    fixture = await openFixture('pre-0019');
    insertConnection('conn-2731-a', 'host-2731-a');
    insertConnection('conn-2731-b', 'host-2731-b');
    insertProject('proj-2731-a', '/home/user/project-2731', 'conn-2731-a');
    expect(() =>
      insertProject('proj-2731-b', '/home/user/project-2731', 'conn-2731-b')
    ).not.toThrow();
  });

  it('still rejects the same path on the same SSH connection', async () => {
    fixture = await openFixture('pre-0019');
    insertConnection('conn-2731-a', 'host-2731-a');
    insertProject('proj-2731-a', '/home/user/project-2731', 'conn-2731-a');
    expect(() => insertProject('proj-2731-dup', '/home/user/project-2731', 'conn-2731-a')).toThrow(
      /unique/i
    );
  });

  it('still rejects two local projects at the same path', async () => {
    fixture = await openFixture('pre-0019');
    insertProject('proj-2731-local', '/home/user/project-2731', null);
    expect(() => insertProject('proj-2731-local-dup', '/home/user/project-2731', null)).toThrow(
      /unique/i
    );
  });

  it('allows a local and an SSH project to share a path string', async () => {
    fixture = await openFixture('pre-0019');
    insertConnection('conn-2731-a', 'host-2731-a');
    insertProject('proj-2731-local', '/home/user/project-2731', null);
    expect(() =>
      insertProject('proj-2731-ssh', '/home/user/project-2731', 'conn-2731-a')
    ).not.toThrow();
  });
});
