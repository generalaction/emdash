import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDb } from '@core/services/app-db/node/db';
import { projects, sshConnections, workspaces } from '@core/services/app-db/node/schema';
import { MachinesService } from './machines-service';

async function insertSshConnection(db: AppDb): Promise<void> {
  await db.insert(sshConnections).values({
    id: 'ssh-1',
    name: 'Existing SSH',
    host: 'example.com',
    port: 22,
    username: 'jona',
    authType: 'agent',
    useAgent: 1,
  });
}

async function insertRemoteWorkspace(db: AppDb): Promise<void> {
  await db.insert(workspaces).values({
    id: 'workspace-root-1',
    key: 'project-ssh:/repo:ssh-1',
    type: 'project-ssh',
    kind: 'project-root',
    location: 'remote',
    sshConnectionId: 'ssh-1',
    path: '/repo',
  });
}

describe('MachinesService', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;
  let service: MachinesService;
  const deleteAllCredentials = vi.fn();
  const dropConnection = vi.fn();
  const removeRuntimeState = vi.fn();

  beforeEach(async () => {
    fixture = await openFixture('empty');
    deleteAllCredentials.mockReset();
    dropConnection.mockReset().mockResolvedValue(undefined);
    removeRuntimeState.mockReset();
    service = new MachinesService({
      db: fixture.db,
      credentials: {
        storePassword: vi.fn(),
        storePassphrase: vi.fn(),
        deleteAllCredentials,
      },
      ssh: {
        dropConnection,
        removeRuntimeState,
      },
      log: { warn: vi.fn() },
    });
  });

  afterEach(() => {
    fixture.close();
  });

  it('rejects duplicate machine names with a user-facing error', async () => {
    await insertSshConnection(fixture.db);

    await expect(
      service.saveMachine({
        name: 'Existing SSH',
        host: 'other.example.com',
        port: 22,
        username: 'jona',
        authType: 'agent',
        useAgent: true,
      })
    ).rejects.toThrow(
      'An SSH connection named “Existing SSH” already exists. Choose a different name.'
    );
  });

  it('allows saving an existing machine without renaming it', async () => {
    await insertSshConnection(fixture.db);
    const events: unknown[] = [];
    service.on('machine:mutated', (event) => {
      events.push(event);
    });

    await expect(
      service.saveMachine({
        id: 'ssh-1',
        name: 'Existing SSH',
        host: 'example.org',
        port: 22,
        username: 'jona',
        authType: 'agent',
        useAgent: true,
      })
    ).resolves.toMatchObject({ id: 'ssh-1', name: 'Existing SSH', host: 'example.org' });
    expect(dropConnection).toHaveBeenCalledWith('ssh-1');
    expect(events).toEqual([{ type: 'saved', connectionId: 'ssh-1' }]);
  });

  it('does not drop a pooled connection when creating a new machine', async () => {
    const events: unknown[] = [];
    service.on('machine:mutated', (event) => {
      events.push(event);
    });

    const saved = await service.saveMachine({
      name: 'New SSH',
      host: 'example.org',
      port: 22,
      username: 'jona',
      authType: 'agent',
      useAgent: true,
    });

    expect(dropConnection).not.toHaveBeenCalled();
    expect(events).toEqual([{ type: 'saved', connectionId: saved.id }]);
  });

  it('deletes an unused machine even when an orphan workspace still references it', async () => {
    await insertSshConnection(fixture.db);
    await insertRemoteWorkspace(fixture.db);
    const events: unknown[] = [];
    service.on('machine:mutated', (event) => {
      events.push(event);
    });

    let credentialDeleteSawConnectionRows: number | undefined;
    deleteAllCredentials.mockImplementation(async (connectionId: string) => {
      const row = fixture.sqlite
        .prepare('SELECT COUNT(*) AS count FROM ssh_connections WHERE id = ?')
        .get(connectionId) as { count: number };
      credentialDeleteSawConnectionRows = row.count;
    });

    await service.deleteMachine('ssh-1');

    const remainingConnections = await fixture.db
      .select()
      .from(sshConnections)
      .where(eq(sshConnections.id, 'ssh-1'));
    const [workspace] = await fixture.db
      .select({ sshConnectionId: workspaces.sshConnectionId })
      .from(workspaces)
      .where(eq(workspaces.id, 'workspace-root-1'));

    expect(remainingConnections).toHaveLength(0);
    expect(workspace?.sshConnectionId).toBeNull();
    expect(credentialDeleteSawConnectionRows).toBe(0);
    expect(dropConnection).toHaveBeenCalledWith('ssh-1');
    expect(deleteAllCredentials).toHaveBeenCalledWith('ssh-1');
    expect(removeRuntimeState).toHaveBeenCalledWith('ssh-1');
    expect(events).toEqual([{ type: 'deleted', connectionId: 'ssh-1' }]);
  });

  it('does not delete credentials when a project still uses the machine', async () => {
    await insertSshConnection(fixture.db);
    await fixture.db.insert(projects).values({
      id: 'project-1',
      name: 'Blocking Project',
      path: '/repo',
      workspaceProvider: 'ssh',
      sshConnectionId: 'ssh-1',
    });

    await expect(service.deleteMachine('ssh-1')).rejects.toThrow(
      'SSH connection is used by Blocking Project'
    );

    const remainingConnections = await fixture.db
      .select()
      .from(sshConnections)
      .where(eq(sshConnections.id, 'ssh-1'));
    expect(remainingConnections).toHaveLength(1);
    expect(dropConnection).not.toHaveBeenCalled();
    expect(deleteAllCredentials).not.toHaveBeenCalled();
    expect(removeRuntimeState).not.toHaveBeenCalled();
  });

  it('removes runtime state when credential cleanup fails after database deletion', async () => {
    await insertSshConnection(fixture.db);
    deleteAllCredentials.mockRejectedValueOnce(new Error('Keychain unavailable'));

    await expect(service.deleteMachine('ssh-1')).rejects.toThrow('Keychain unavailable');

    const remainingConnections = await fixture.db
      .select()
      .from(sshConnections)
      .where(eq(sshConnections.id, 'ssh-1'));
    expect(remainingConnections).toHaveLength(0);
    expect(removeRuntimeState).toHaveBeenCalledWith('ssh-1');
  });
});
